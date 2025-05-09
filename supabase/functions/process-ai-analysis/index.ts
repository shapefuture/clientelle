// supabase/functions/process-ai-analysis/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
import 'https://deno.land/x/dotenv@v3.2.2/load.ts'; // Для локального тестирования
import { completion } from 'npm:litellm'; // Импортируем функцию completion из litellm

// Получаем URL Supabase и наш Service Role Key
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SERVICE_KEY'); // Ваше имя секрета

// Инициализируем клиента Supabase с Service Role Key (для записи инсайтов - игнорируем RLS)
const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
   auth: { persistSession: false },
});

// Получаем API ключи LLM из секретов
const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

// Определите, какой ключ использовать и какую модель
// litellm позволяет указать модель с префиксом провайдера, например 'openai/gpt-4o-mini' или 'gemini/gemini-pro'
// Убедитесь, что у вас установлен соответствующий ключ в секретах
const usedModel = 'gpt-4o-mini'; // Пример: используем модель через OpenRouter или OpenAI.
// Если используете Gemini напрямую через litellm, модель может быть 'gemini/gemini-pro'

serve(async (req) => {
  // Проверяем метод запроса
   if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
   }

  // Парсим тело запроса (ожидаем JSON с ID сырых данных и user_id)
  const { raw_data_id, user_id } = await req.json();

  // Проверяем наличие необходимых данных
  if (!raw_data_id || !user_id) {
     return new Response(JSON.stringify({ error: 'raw_data_id and user_id are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // 1. Получаем сырой текст из таблицы raw_data по ID, используя Service Role Key
    // Использование Service Role Key позволяет обойти RLS, но все равно добавляем проверку user_id для безопасности
    const { data: rawData, error: fetchError } = await supabase
      .from('raw_data')
      .select('content')
      .eq('id', raw_data_id)
      .eq('user_id', user_id) // Проверка, что данные принадлежат пользователю
      .single(); // Ожидаем одну строку

    if (fetchError || !rawData) {
        throw new Error(fetchError?.message || `Raw data with ID ${raw_data_id} not found or does not belong to user ${user_id}`);
    }

    const text_content = rawData.content;

    // 2. Вызываем LLM для анализа текста с использованием Litellm
    // Подготовьте ваш промпт! Это КЛЮЧЕВАЯ часть, определяющая качество инсайтов.
    // Промпт должен четко инструктировать LLM, что извлечь (цитаты, боли, решения, узлы, связи)
    // и в каком ФОРМАТЕ вернуть ответ (например, JSON).

    const system_prompt = `You are an expert analyst. Analyze the provided text about customer feedback, interviews, or research notes. Extract key insights, organize them into structured data. Identify distinct quotes, customer pain points, proposed solutions, discussed features, and overarching themes. Represent these as Nodes and Relationships (Edges) for a Knowledge Graph or Mind Map, linking relevant quotes to Nodes. Format the output as a single JSON object.`;

    const user_prompt = `Analyze the following text. Extract:
    - Key Quotes (precise sentences or paragraphs)
    - Pain Points (customer problems, frustrations)
    - Solutions (ideas or features that address pains)
    - Themes (major topics or categories)
    - Connections/Relationships between these concepts (e.g., Pain X leads to Idea Y, Quote Z supports Pain X).

    Provide the output as a JSON object with the following structure:
    {
      "quotes": [{ "id": 1, "text": "...", "start_index": ..., "end_index": ... }], // Include character indices if possible
      "nodes": [{ "id": 1, "type": "pain|solution|theme|feature", "label": "...", "description": "..." }],
      "edges": [{ "from_node_id": 1, "to_node_id": 2, "type": "causes|solves|relates_to|supports", "description": "..." }],
      "quote_node_links": [{ "quote_id": 1, "node_id": 2, "type": "supports" }] // Link quotes to nodes they support
    }
    Ensure unique IDs within each array in the JSON output. Indices should refer to items within the same JSON output, not database IDs.

    Text to analyze: """${text_content}"""
    `;

    try {
      // Вызов Litellm completion
      const chatCompletion = await completion({
          model: usedModel, // Например, 'gpt-4o-mini' или 'gemini/gemini-pro'
          messages: [
              { role: 'system', content: system_prompt },
              { role: 'user', content: user_prompt },
          ],
          // Дополнительные параметры, если нужны (температура, max_tokens, response_format и т.д.)
           response_format: { type: "json_object" }, // Запрос JSON формата, если модель поддерживает
      });

      // litellm возвращает ответ в формате OpenAI Chat Completion
      const rawLlMResponse = chatCompletion.choices[0].message.content;

      if (!rawLlMResponse) {
          throw new Error("LLM returned empty response.");
      }

      // Парсим JSON ответ от LLM
      const analysisResult = JSON.parse(rawLlMResponse);

      // 3. Сохраняем результаты анализа в базу данных, используя Supabase клиент с Service Role Key
      // Логика сохранения должна учитывать структуру вашего analysisResult и вставлять данные в соответствующие таблицы.
      // Это может быть сложная часть, требующая обработки возможных ошибок парсинга JSON и ошибок БД.

      // Пример сохранения цитат:
      if (analysisResult.quotes && Array.isArray(analysisResult.quotes)) {
          const quotesToInsert = analysisResult.quotes.map((q: any) => ({
             raw_data_id: raw_data_id, // Привязываем цитаты к источнику сырых данных
             user_id: user_id, // Привязываем к пользователю
             text: q.text,
             start_char_index: q.start_index, // Если LLM смог извлечь индексы
             end_char_index: q.end_index,
             is_suggestion: true // Помечаем как AI-предложение
          }));
           // Используем upsert или insert с ignore/update на случай повторного анализа
           const { error: insertQuotesError } = await supabase.from('quotes').insert(quotesToInsert, { onConflict: 'text, raw_data_id, user_id' }); // Пример onConflict
           if (insertQuotesError) console.error('Error inserting quotes:', insertQuotesError);
      }

      // Пример сохранения узлов (Nodes):
      if (analysisResult.nodes && Array.isArray(analysisResult.nodes)) {
           // Если LLM предоставил временные ID для узлов в JSON, вам нужно будет сопоставить их с реальными ID после вставки.
           // Простейший подход: просто вставлять узлы без учета временных ID и связей на этом шаге.
           const nodesToInsert = analysisResult.nodes.map((n: any) => ({
               user_id: user_id,
               type: n.type, // 'pain', 'solution', 'theme', 'feature'
               label: n.label,
               description: n.description,
               is_suggestion: true
               // embedding будет добавлен позже отдельным процессом или в update
           }));

           const { data: insertedNodes, error: insertNodesError } = await supabase.from('nodes').insert(nodesToInsert).select(); // select для получения реальных ID
           if (insertNodesError) console.error('Error inserting nodes:', insertNodesError);

           // Если нужно сохранить связи (edges) и связи цитат с узлами (quote_node_links),
           // вам потребуется логика сопоставления временных ID из analysisResult
           // с реальными ID, полученными после вставки insertedNodes и insertedQuotes.
           // Это сложная логика, ее нужно тщательно продумать.
           // Например, пройтись по analysisResult.edges, найти реальные ID для from_node_id и to_node_id
           // среди insertedNodes (сопоставляя по type+label или временному ID, если LLM его вернул),
           // и затем вставить связи в таблицу 'edges'. Аналогично для 'quote_node_links'.
           // Для MVP можно пропустить сохранение edges и quote_node_links на этом шаге и создавать их вручную или в другом процессе.
      }


      // 4. Обновляем запись в raw_data, помечая, что анализ завершен
       const { error: updateRawDataError } = await supabase
        .from('raw_data')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', raw_data_id); // Обновляем запись по ID
       if (updateRawDataError) console.error('Error updating raw_data processed status:', updateRawDataError);


      // 5. Возвращаем успешный ответ
      return new Response(JSON.stringify({ message: 'Analysis completed and results saved.', raw_data_id: raw_data_id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (llmError: any) {
        // Обработка ошибок при вызове или парсинге ответа LLM
        console.error('Error during LLM analysis or parsing:', llmError.message);
         // Можно записать статус ошибки в analysis_queue или raw_data
        return new Response(JSON.stringify({ error: 'Analysis failed: ' + llmError.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
    }

  } catch (error: any) {
    // Общая обработка ошибок (например, при получении данных из БД)
    console.error('Error in process-ai-analysis function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});