// supabase/functions/upload-data/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
// NOTE: Do not import dotenv in deployed edge functions; environment variables are injected automatically.

// Получаем URL Supabase и наш Service Role Key из переменных окружения
const supabaseUrl = Deno.env.get('SUPABASE_URL');
// Используем имя секрета, которое вы установили: SERVICE_KEY
const serviceRoleKey = Deno.env.get('SERVICE_KEY');

// Инициализируем клиента Supabase с Service Role Key
const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
  auth: {
    // Важно: в функциях с Service Role Key не нужно сохранять сессию или проверять JWT по умолчанию,
    // если вы хотите полные права доступа. Если нужна аутентификация пользователя внутри функции,
    // ее нужно обрабатывать отдельно (например, передавать JWT с фронтенда).
    persistSession: false,
  },
});

// Обработчик HTTP запросов для функции
serve(async (req) => {
  // Проверяем метод запроса
  if (req.method !== 'POST') {
     return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  // Parse POST body (expecting JSON)
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { text_content, source_metadata, user_ai_key } = body;

  // Validate required fields
  if (!text_content) {
    return new Response(JSON.stringify({ error: 'text_content is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const user_id = source_metadata?.user_id || null; // Require user_id to be set from frontend/session

   if (!user_id) {
       // Если user_id не пришел, и функция не защищена JWT, мы не знаем, чей это пользователь.
       // Для безопасности, возможно, стоит требовать user_id или использовать JWT защиту.
       // Временно, для примера, используем заглушку или auth.uid() (который может быть null/анонимным с Service Role Key)
        console.warn("User ID not provided in upload request. Using a placeholder or relying on RLS if applicable.");
       // В реальном приложении здесь может быть ошибка или проверка JWT
   }


  try {
    // 1. Сохраняем информацию об источнике в таблице 'sources'
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert([{
        user_id: user_id || '00000000-0000-0000-0000-000000000000', // Используем полученный user_id или заглушку
        type: source_metadata?.type || 'manual', // Тип источника
        url: source_metadata?.url, // URL источника
        metadata: source_metadata // Все метаданные сохраняем как JSONB
      }])
      .select() // Выбираем вставленную строку, чтобы получить ID
      .single(); // Ожидаем одну строку

    if (sourceError) throw sourceError; // Если ошибка при сохранении источника, прекращаем выполнение

    // 2. Сохраняем сырой текст в таблице 'raw_data'
    const { data: rawData, error: rawDataError } = await supabase
      .from('raw_data')
      .insert([{
        source_id: source.id, // Связываем с сохраненным источником
        user_id: user_id || '00000000-0000-0000-0000-000000000000', // Используем user_id
        content: text_content // Сам текст
      }])
      .select() // Выбираем вставленную строку, чтобы получить ID
      .single(); // Ожидаем одну строку

    if (rawDataError) throw rawDataError; // Если ошибка при сохранении текста, прекращаем выполнение

    // 3. Trigger process-ai-analysis edge function and securely pass user_ai_key
    try {
      const { data: analysisInvokeResult, error: analysisInvokeError } = await supabase.functions.invoke('process-ai-analysis', {
        body: {
          raw_data_id: rawData.id,
          user_id: user_id,
          user_ai_key: user_ai_key // pass (may be undefined/null)
        }
      });

      if (analysisInvokeError) {
        // Do NOT log user_ai_key, just log the error message
        console.error('Error invoking process-ai-analysis function:', analysisInvokeError);
      }
    } catch (invokeErr) {
      console.error('Exception during invoking process-ai-analysis function:', invokeErr);
    }


    // 4. Return success response to frontend
    return new Response(JSON.stringify({
      message: 'Data uploaded and analysis function invoked',
      raw_data_id: rawData.id,
      source_id: source.id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // Error handler
    console.error('Error in upload-data function:', error?.message);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});