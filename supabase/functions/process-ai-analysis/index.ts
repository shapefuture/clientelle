// supabase/functions/process-ai-analysis/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
// NOTE: Do not import dotenv in deployed edge functions; environment variables are injected automatically.
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

  // Parse POST body (expecting JSON with raw_data_id, user_id, and optional user_ai_key)
  let body;
  try {
    body = await req.json();
  } catch (err) {
    // For verbose error logging in dev/staging, comment out in production if desired.
    console.error('[process-ai-analysis] JSON parse error:', err);
    return new Response(JSON.stringify({ error: 'Invalid JSON body', debug: err?.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { raw_data_id, user_id, user_ai_key } = body;

  if (!raw_data_id || !user_id) {
    console.error('[process-ai-analysis] Missing raw_data_id or user_id', { raw_data_id, user_id });
    return new Response(JSON.stringify({ error: 'raw_data_id and user_id are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // 1. Получаем сырой текст из таблицы raw_data по ID, используя Service Role Key
    // Использование Service Role Key позволяет обойти RLS, но все равно добавляем проверку user_id для безопасности
    let rawData;
    try {
      const { data, error } = await supabase
        .from('raw_data')
        .select('content')
        .eq('id', raw_data_id)
        .eq('user_id', user_id)
        .single();
      if (error || !data) throw new Error(error?.message || `Raw data with ID ${raw_data_id} not found or does not belong to user ${user_id}`);
      rawData = data;
    } catch (err) {
      console.error('[process-ai-analysis] Failed to fetch raw_data:', err);
      return new Response(JSON.stringify({ error: err?.message || String(err), debug: err?.stack }), { status: 404, headers: { 'Content-Type': 'application/json' } });
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
      // Decide which API key to use for LLM
      // Priority: user_ai_key (if present and non-empty), else openrouterApiKey, else geminiApiKey
      let selectedApiKey = null;
      let selectedProvider = null;
      if (user_ai_key && typeof user_ai_key === 'string' && user_ai_key.trim().length > 0) {
        selectedApiKey = user_ai_key;
        selectedProvider = 'user';
      } else if (openrouterApiKey) {
        selectedApiKey = openrouterApiKey;
        selectedProvider = 'openrouter';
      } else if (geminiApiKey) {
        selectedApiKey = geminiApiKey;
        selectedProvider = 'gemini';
      } else {
        throw new Error('No valid API key available for LLM call.');
      }

      // Prepare litellm config for user key
      let litellmParams: any = {
        model: usedModel,
        messages: [
          { role: 'system', content: system_prompt },
          { role: 'user', content: user_prompt },
        ],
        response_format: { type: "json_object" },
      };

      // Add key to litellm's config as per model/provider
      if (selectedProvider === 'user' || selectedProvider === 'openrouter' || selectedProvider === 'gemini') {
        litellmParams['api_key'] = selectedApiKey;
      }

      // Call Litellm completion
      let chatCompletion;
      try {
        chatCompletion = await completion(litellmParams);
      } catch (llmApiErr) {
        console.error('[process-ai-analysis] LLM API error:', llmApiErr?.message, llmApiErr?.stack);
        return new Response(JSON.stringify({ error: 'LLM API call failed', debug: llmApiErr?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      // litellm returns OpenAI Chat Completion format
      const rawLlMResponse = chatCompletion.choices?.[0]?.message?.content;

      if (!rawLlMResponse) {
        console.error('[process-ai-analysis] LLM empty response');
        return new Response(JSON.stringify({ error: "LLM returned empty response." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      // Parse LLM JSON
      let analysisResult;
      try {
        analysisResult = JSON.parse(rawLlMResponse);
      } catch (parseErr) {
        console.error('[process-ai-analysis] LLM JSON parse error:', parseErr?.message, parseErr?.stack);
        return new Response(JSON.stringify({ error: "Failed to parse LLM JSON response", debug: parseErr?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      // 3. Сохраняем результаты анализа в базу данных, используя Supabase клиент с Service Role Key
      // Логика сохранения должна учитывать структуру вашего analysisResult и вставлять данные в соответствующие таблицы.
      // Это может быть сложная часть, требующая обработки возможных ошибок парсинга JSON и ошибок БД.

      // Save quotes and nodes, and map temporary LLM IDs to DB UUIDs for linking
      let quoteTempIdToDbId: Record<string, string> = {};
      let nodeTempIdToDbId: Record<string, string> = {};
      let saveDebug = {};

      // Save quotes
      if (analysisResult.quotes && Array.isArray(analysisResult.quotes)) {
        const quotesToInsert = analysisResult.quotes.map((q: any) => ({
          raw_data_id: raw_data_id,
          user_id: user_id,
          text: q.text,
          start_char_index: q.start_index,
          end_char_index: q.end_index,
          is_suggestion: true
        }));
        try {
          const { data: insertedQuotes, error: insertQuotesError } = await supabase
            .from('quotes')
            .insert(quotesToInsert)
            .select();
          if (insertQuotesError) throw insertQuotesError;
          if (insertedQuotes) {
            for (let i = 0; i < analysisResult.quotes.length; i++) {
              const tempId = analysisResult.quotes[i].id ?? i;
              quoteTempIdToDbId[tempId] = insertedQuotes[i].id;
            }
          }
          saveDebug['quotes'] = 'success';
        } catch (err) {
          saveDebug['quotes'] = err?.message;
          console.error('[process-ai-analysis] Error inserting quotes:', err);
        }
      }

      // Save nodes
      if (analysisResult.nodes && Array.isArray(analysisResult.nodes)) {
        const nodesToInsert = analysisResult.nodes.map((n: any) => ({
          user_id: user_id,
          type: n.type,
          label: n.label,
          description: n.description,
          is_suggestion: true
        }));
        try {
          const { data: insertedNodes, error: insertNodesError } = await supabase
            .from('nodes')
            .insert(nodesToInsert)
            .select();
          if (insertNodesError) throw insertNodesError;
          if (insertedNodes) {
            for (let i = 0; i < analysisResult.nodes.length; i++) {
              const tempId = analysisResult.nodes[i].id ?? i;
              nodeTempIdToDbId[tempId] = insertedNodes[i].id;
            }
          }
          saveDebug['nodes'] = 'success';
        } catch (err) {
          saveDebug['nodes'] = err?.message;
          console.error('[process-ai-analysis] Error inserting nodes:', err);
        }
      }

      // Save edges
      if (analysisResult.edges && Array.isArray(analysisResult.edges)) {
        const edgesToInsert = analysisResult.edges
          .map((e: any) => {
            const fromNodeId = nodeTempIdToDbId[e.from_node_id];
            const toNodeId = nodeTempIdToDbId[e.to_node_id];
            if (!fromNodeId || !toNodeId) return null;
            return {
              user_id: user_id,
              from_node_id: fromNodeId,
              to_node_id: toNodeId,
              type: e.type,
              description: e.description,
              is_suggestion: true
            };
          })
          .filter(Boolean);
        try {
          if (edgesToInsert.length > 0) {
            const { error: insertEdgesError } = await supabase
              .from('edges')
              .insert(edgesToInsert);
            if (insertEdgesError) throw insertEdgesError;
          }
          saveDebug['edges'] = 'success';
        } catch (err) {
          saveDebug['edges'] = err?.message;
          console.error('[process-ai-analysis] Error inserting edges:', err);
        }
      }

      // Save quote_node_links
      if (analysisResult.quote_node_links && Array.isArray(analysisResult.quote_node_links)) {
        const linksToInsert = analysisResult.quote_node_links
          .map((l: any) => {
            const dbQuoteId = quoteTempIdToDbId[l.quote_id];
            const dbNodeId = nodeTempIdToDbId[l.node_id];
            if (!dbQuoteId || !dbNodeId) return null;
            return {
              quote_id: dbQuoteId,
              node_id: dbNodeId,
              type: l.type,
              user_id: user_id
            };
          })
          .filter(Boolean);
        try {
          if (linksToInsert.length > 0) {
            const { error: insertLinksError } = await supabase
              .from('quote_node_links')
              .insert(linksToInsert);
            if (insertLinksError) throw insertLinksError;
          }
          saveDebug['quote_node_links'] = 'success';
        } catch (err) {
          saveDebug['quote_node_links'] = err?.message;
          console.error('[process-ai-analysis] Error inserting quote_node_links:', err);
        }
      }


      // 4. Update raw_data with processed_at timestamp
      try {
        const { error: updateRawDataError } = await supabase
          .from('raw_data')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', raw_data_id);
        if (updateRawDataError) {
          saveDebug['raw_data_update'] = updateRawDataError.message;
          console.error('[process-ai-analysis] Error updating raw_data processed status:', updateRawDataError);
        } else {
          saveDebug['raw_data_update'] = 'success';
        }
      } catch (err) {
        saveDebug['raw_data_update'] = err?.message;
        console.error('[process-ai-analysis] Exception updating raw_data:', err);
      }

      // 5. Detailed response for debugging and test automation
      return new Response(JSON.stringify({
        message: 'Analysis completed and results saved.',
        raw_data_id: raw_data_id,
        debug: saveDebug
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (llmError: any) {
      console.error('[process-ai-analysis] LLM or parsing error:', llmError?.message, llmError?.stack);
      return new Response(JSON.stringify({ error: 'Analysis failed: ' + llmError?.message, debug: llmError?.stack }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('[process-ai-analysis] Fatal error:', error?.message, error?.stack);
    return new Response(JSON.stringify({ error: error?.message, debug: error?.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// For testing: Add integration tests that send requests to this function and verify robust error/debug info!