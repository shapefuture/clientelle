-- Вставьте этот код в ваш файл миграции

-- Таблица для хранения информации об источниках данных (например, URL статьи, имя файла)
create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null, -- Связь с пользователем
  type text not null, -- Тип источника (например, 'webpage', 'file_pdf', 'manual_input', 'api')
  url text, -- URL, если применимо
  file_path text, -- Путь к файлу в хранилище, если применимо
  created_at timestamp with time zone default now() not null,
  metadata jsonb -- Для хранения дополнительных данных (например, название файла, автор, дата публикации из метаданных)
);

-- Таблица для хранения сырых текстовых данных, извлеченных из источников
create table raw_data (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) not null, -- Связь с источником
  user_id uuid references auth.users(id) not null, -- Связь с пользователем
  content text not null, -- Собственно текст данных
  created_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone -- Отметка о времени обработки AI
);

-- Таблица для хранения извлеченных цитат (ключевых фрагментов текста)
create table quotes (
  id uuid primary key default gen_random_uuid(),
  raw_data_id uuid references raw_data(id) not null, -- Связь с сырыми данными
  user_id uuid references auth.users(id) not null, -- Связь с пользователем
  text text not null, -- Текст цитаты
  start_char_index integer, -- Начальный индекс в raw_data.content (для точного позиционирования)
  end_char_index integer, -- Конечный индекс в raw_data.content
  created_at timestamp with time zone default now() not null,
  -- Дополнительные поля, которые может извлечь AI
  sentiment text, -- Например, 'positive', 'negative', 'neutral'
  emotions text[], -- Массив эмоций (например, ['радость', 'грусть'])
  metadata jsonb, -- Для других AI-атрибутов или пометок
  is_suggestion boolean default false, -- Предложение от AI
  reviewed_at timestamp with time zone, -- Время модерации предложения
  reviewed_by uuid references auth.users(id) -- Кто модерировал
);

-- Таблица для хранения узлов Карты Смыслов (концепций, болей, решений и т.д.)
create table nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null, -- Связь с пользователем
  type text not null, -- Тип узла (например, 'pain', 'solution', 'feature', 'theme', 'job_to_be_done')
  label text not null, -- Короткое название/заголовок узла
  description text, -- Более подробное описание
  created_at timestamp with time zone default now() not null,
  -- Поля для векторного поиска (после включения PGvector)
  embedding vector(1536), -- Или другой размерность вектора, зависящая от вашей LLM
  is_suggestion boolean default false, -- Предложение от AI
  reviewed_at timestamp with time zone, -- Время модерации предложения
  reviewed_by uuid references auth.users(id) -- Кто модерировал
);

-- Таблица для связей между узлами
create table edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null, -- Связь с пользователем
  from_node_id uuid references nodes(id) not null, -- Узел-источник
  to_node_id uuid references nodes(id) not null, -- Узел-назначение
  type text, -- Тип связи (например, 'causes', 'solves', 'relates_to', 'supports')
  description text, -- Описание связи
  created_at timestamp with time zone default now() not null,
  is_suggestion boolean default false, -- Предложение от AI
  reviewed_at timestamp with time zone, -- Время модерации предложения
  reviewed_by uuid references auth.users(id) -- Кто модерировал
);

 -- Таблица для связи цитат с узлами (какие цитаты подтверждают/относятся к какому узлу)
 create table quote_node_links (
   id uuid primary key default gen_random_uuid(),
   quote_id uuid references quotes(id) not null,
   node_id uuid references nodes(id) not null,
   user_id uuid references auth.users(id) not null,
   created_at timestamp with time zone default now() not null,
   is_suggestion boolean default false, -- Предложение от AI
   reviewed_at timestamp with time zone, -- Время модерации предложения
   reviewed_by uuid references auth.users(id), -- Кто модерировал
   unique (quote_id, node_id) -- Цитата может быть связана с узлом только один раз
 );


-- Таблица для хранения сгенерированных идей
create table ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null, -- Связь с пользователем
  generated_from_node_id uuid references nodes(id), -- Ссылка на узел, на основе которого сгенерирована идея
  generated_from_quote_id uuid references quotes(id), -- Ссылка на цитату, на основе которой сгенерирована идея
  text text not null, -- Текст идеи
  type text, -- Тип идеи (например, 'marketing_hook', 'feature_idea', 'content_topic')
  created_at timestamp with time zone default now() not null,
  status text default 'generated', -- Статус идеи (например, 'generated', 'approved', 'implemented', 'discarded')
  metadata jsonb, -- Для хранения метрик, результатов, ссылок на задачи и т.д.
  is_suggestion boolean default false, -- Предложение от AI
  reviewed_at timestamp with time zone, -- Время модерации предложения
  reviewed_by uuid references auth.users(id) -- Кто модерировал
);

-- Таблица для управления очередью AI-анализа (если нужен более сложный процессинг)
-- create table analysis_queue (
--   id uuid primary key default gen_random_uuid(),
--   raw_data_id uuid references raw_data(id) not null,
--   status text default 'pending' not null, -- 'pending', 'processing', 'completed', 'failed'
--   created_at timestamp with time zone default now() not null,
--   processed_at timestamp with time zone,
--   error_message text
-- );


-- Включите Row Level Security (RLS) для всех таблиц!
alter table sources enable row level security;
alter table raw_data enable row level security;
alter table quotes enable row level security;
alter table nodes enable row level security;
alter table edges enable row level security;
alter table quote_node_links enable row level security;
alter table ideas enable row level security;
-- alter table analysis_queue enable row level security; -- Если используется

-- Создайте политики RLS, чтобы пользователи могли видеть/изменять только СВОИ данные
-- Политика SELECT для всех таблиц
create policy select_own_data on sources for select using (auth.uid() = user_id);
create policy select_own_data on raw_data for select using (auth.uid() = user_id);
create policy select_own_data on quotes for select using (auth.uid() = user_id);
create policy select_own_data on nodes for select using (auth.uid() = user_id);
create policy select_own_data on edges for select using (auth.uid() = user_id);
create policy select_own_data on quote_node_links for select using (auth.uid() = user_id);
create policy select_own_data on ideas for select using (auth.uid() = user_id);
-- create policy select_own_data on analysis_queue for select using (auth.uid() = user_id); -- Если используется

-- Политика INSERT для всех таблиц (пользователи могут добавлять данные с привязкой к себе)
create policy insert_own_data on sources for insert with check (auth.uid() = user_id);
create policy insert_own_data on raw_data for insert with check (auth.uid() = user_id);
create policy insert_own_data on quotes for insert with check (auth.uid() = user_id);
create policy insert_own_data on nodes for insert with check (auth.uid() = user_id);
create policy insert_own_data on edges for insert with check (auth.uid() = user_id);
create policy insert_own_data on quote_node_links for insert with check (auth.uid() = user_id);
create policy insert_own_data on ideas for insert with check (auth.uid() = user_id);
-- create policy insert_own_data on analysis_queue for insert with check (auth.uid() = user_id); -- Если используется

-- Политика UPDATE для всех таблиц (пользователи могут обновлять СВОИ данные)
create policy update_own_data on sources for update using (auth.uid() = user_id);
create policy update_own_data on raw_data for update using (auth.uid() = user_id);
create policy update_own_data on quotes for update using (auth.uid() = user_id);
create policy update_own_data on nodes for update using (auth.uid() = user_id);
create policy update_own_data on edges for update using (auth.uid() = user_id);
create policy update_own_data on quote_node_links for update using (auth.uid() = user_id);
create policy update_own_data on ideas for update using (auth.uid() = user_id);
-- create policy update_own_data on analysis_queue for update using (auth.uid() = user_id); -- Если используется

-- Политика DELETE для всех таблиц (пользователи могут удалять СВОИ данные)
create policy delete_own_data on sources for delete using (auth.uid() = user_id);
create policy delete_own_data on raw_data for delete using (auth.uid() = user_id);
create policy delete_own_data on quotes for delete using (auth.uid() = user_id);
create policy delete_own_data on nodes for delete using (auth.uid() = user_id);
create policy delete_own_data on edges for delete using (auth.uid() = user_id);
create policy delete_own_data on quote_node_links for delete using (auth.uid() = user_id);
create policy delete_own_data on ideas for delete using (auth.uid() = user_id);
-- create policy delete_own_data on analysis_queue for delete using (auth.uid() = user_id); -- Если используется

-- ВАЖНО: Убедитесь, что расширение "pgvector" включено в интерфейсе Supabase
-- Project Settings -> Database -> Extensions
-- После включения расширения, если вы еще не сделали, вам может понадобиться ALTER TABLE ADD COLUMN ... с типом vector.
-- Пример ALTER TABLE для добавления вектора к quotes, если таблица уже существует без него
-- ALTER TABLE quotes ADD COLUMN embedding vector(1536);