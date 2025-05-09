// supabase/functions/upload-data/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
// dotenv для локального тестирования. В развернутой функции переменные окружения доступны автоматически.
import 'https://deno.land/x/dotenv@v3.2.2/load.ts';

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

  // Парсим тело запроса (ожидаем JSON)
  const { text_content, source_metadata } = await req.json();

  // Проверяем наличие необходимых данных
  if (!text_content) {
     return new Response(JSON.stringify({ error: 'text_content is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Получаем user_id. Лучше всего, если фронтенд передает user_id текущего пользователя.
  // Если вы полагаетесь на RLS и передаете Service Role Key, user_id при insert/update нужно устанавливать явно.
  // В этом примере предполагаем, что user_id передан в source_metadata
  const user_id = source_metadata?.user_id || null; // Получаем user_id из метаданных или null

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

    // 3. Опционально: Вызываем функцию AI-анализа для только что сохраненных данных
    // Это можно сделать либо прямым вызовом другой Edge Function, либо добавив запись в очередь (если у вас есть таблица 'analysis_queue')

    // Пример прямого вызова функции 'process-ai-analysis':
    // Важно: При вызове одной Edge Function из другой, они должны быть в одном регионе
    // и вызываться с правами service_role (если нужно).
    try {
        const { data: analysisInvokeResult, error: analysisInvokeError } = await supabase.functions.invoke('process-ai-analysis', {
          body: { raw_data_id: rawData.id, user_id: user_id }, // Передаем ID сырых данных и user_id для анализа
          // Headers для аутентификации, если функция process-ai-analysis защищена JWT.
          // Если обе функции развернуты с --no-verify-jwt и вызываются с Service Role, auth не нужен.
          // headers: { 'Authorization': `Bearer ${serviceRoleKey}` } // Пример вызова с Service Role Key (может не сработать напрямую)
        });

        if (analysisInvokeError) {
            console.error('Error invoking process-ai-analysis function:', analysisInvokeError);
            // Можно записать ошибку в лог или статус в analysis_queue
        } else {
            console.log('Successfully invoked process-ai-analysis function:', analysisInvokeResult);
        }
    } catch (invokeErr) {
         console.error('Exception during invoking process-ai-analysis function:', invokeErr);
    }


    // 4. Возвращаем успешный ответ фронтенду
    return new Response(JSON.stringify({
      message: 'Data uploaded and analysis function invoked',
      raw_data_id: rawData.id, // Возвращаем ID сохраненных данных
      source_id: source.id, // Возвращаем ID источника
      // status_invoke: analysisInvokeError ? 'failed' : 'success' // Статус вызова анализа
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // Обработка ошибок при работе с БД или вызове других функций
    console.error('Error in upload-data function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});