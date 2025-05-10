// supabase/functions/get-insights/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

// Получаем URL Supabase и Anon Key (публичный ключ)
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY'); // Anon Key доступен по умолчанию

// Инициализируем клиента Supabase с Anon Key
// RLS-политики, которые вы настроили, будут ограничивать доступ к данным только текущего пользователя.
const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
   auth: { persistSession: false },
});

serve(async (req) => {
  // Проверяем метод запроса (обычно GET или POST)
   if (req.method !== 'GET' && req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
   }

   // Парсим параметры запроса
   // В GET запросе параметры в URL query string, в POST - в теле JSON
   const params = req.method === 'POST' ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);

   const { user_id, view_type, source_id, node_id, filters } = params;

   // Require user_id for security
   if (!user_id) {
       return new Response(JSON.stringify({ error: 'user_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
   }


  try {
    let query;

    // Определяем, какие данные выбрать, в зависимости от view_type
    if (view_type === 'list_quotes') {
        // Получаем список цитат
         query = supabase
          .from('quotes')
          .select('id, text, sentiment, emotions, raw_data(id, source_id, sources(id, type, metadata))') // Выбираем поля и связанные данные
          .eq('user_id', user_id); // Фильтрация (RLS тоже сработает)

        // Добавить фильтрацию по 'is_suggestion', source_id и другим параметрам из filters

    } else if (view_type === 'list_nodes') {
         // Получаем список узлов
          query = supabase
           .from('nodes')
           .select('id, type, label, description') // Выбираем поля
           .eq('user_id', user_id); // Фильтрация

         // Добавить фильтрацию по type, is_suggestion и другим параметрам

    } else if (view_type === 'graph_data') {
        // Получаем данные для построения графа (узлы, связи, возможно, связанные цитаты)
         query = supabase
           .from('nodes')
           .select('id, type, label, description, embedding, edges!from_node_id(id, from_node_id, to_node_id, type, description), quote_node_links(id, quote_id, node_id, quotes(id, text))') // Выбираем узлы и связанные связи/цитаты
           .eq('user_id', user_id); // Фильтрация

         // Добавить фильтрацию для графа, если нужно показывать только часть графа

    } else if (view_type === 'ideas') {
        // Получаем список идей
         query = supabase
           .from('ideas')
           .select('id, text, type, status, generated_from_node_id, generated_from_quote_id')
           .eq('user_id', user_id); // Фильтрация
        // Добавить фильтрацию по status или type

    }
     // else if (view_type === 'single_node') { ... } // Для получения данных одного узла
     // else if (view_type === 'single_quote') { ... } // Для получения данных одной цитаты
     else {
         // Если view_type не определен или некорректен
          return new Response(JSON.stringify({ error: 'Invalid or missing view_type' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
     }

    // Здесь можно добавить общую логику фильтрации, сортировки, пагинации на основе объекта filters

    const { data, error: fetchError } = await query;

    if (fetchError) {
        console.error('Error fetching data from DB:', fetchError);
        throw fetchError; // Пробрасываем ошибку
    }

    // 3. Возвращаем данные фронтенду в формате JSON
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // Обработка ошибок при запросе к БД или парсинге запроса
    console.error('Error in get-insights function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});