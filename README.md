# ♪ MP3 Player

Minimalist MP3 плеер на Electron с тёмной темой, визуализатором и поддержкой скинов.

![](https://img.shields.io/badge/platform-macOS-blue)
![](https://img.shields.io/badge/electron-35-blue)

## Возможности

- Воспроизведение MP3, WAV, OGG, FLAC, M4A
- Плейлист с drag-and-drop, контекстным меню, двойным кликом
- 4 темы оформления: Deep Purple, WinAMP Classic, Ocean Blue, Amber Glow
- Визуализатор с 3 режимами: бары, волна, круг
- Repeat (off/all/one) и Shuffle
- Менеджер плейлистов (сохранить/загрузить/удалить)
- Горячие клавиши: Space, ←→, ↑↓, N/P, R, S, T
- Системные медиа-кнопки (MediaSession API)
- Автосохранение состояния (плейлист, позиция, настройки)

## Установка

### Из DMG (рекомендуется)

Скачай последний релиз со страницы [Releases](https://github.com/mb-mal/mp3player/releases):

```
MP3 Player-1.0.0-arm64.dmg
```

Открой DMG и перетащи приложение в `/Applications`.

> Первый запуск: macOS может заблокировать неподписанное приложение. Нажми правой кнопкой → **Открыть**.

### Из исходников

```bash
git clone https://github.com/mb-mal/mp3player.git
cd mp3player
npm install
npm start          # запуск
npm run dev        # запуск с DevTools
```

### Сборка установщика

```bash
npm run build      # .app + .dmg
npm run build:dmg  # только .dmg
```

## Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| `Space` | Play / Pause |
| `←` `→` | Назад / Вперёд на 5 с |
| `↑` `↓` | Громкость (с ускорением при удержании) |
| `N` / `P` | Следующий / Предыдущий трек |
| `R` | Режим повтора |
| `S` | Перемешать |
| `T` | Сменить тему |
| `V` | Сменить визуализатор |
| `⌘O` | Добавить файлы |
| `Delete` | Удалить трек |
| `Escape` | Стоп |

## Сборка

```bash
npm install
npm run build
```

Готовый `.app` и `.dmg` появятся в `dist/`.
