-- Источник при пересмотре события заменяет строку новой, с новым id, а старая со
-- страницы исчезает. Сверка окна отличает такую ревизию от нового события и от
-- отзыва; отозванные строки не удаляются, а помечаются и выпадают из списков.
ALTER TABLE earthquake_event ADD COLUMN retracted_at TEXT;

CREATE INDEX idx_earthquake_event_retracted ON earthquake_event(retracted_at);
