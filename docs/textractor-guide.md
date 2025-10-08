---
description: Step-by-step Textractor setup guide for extracting Japanese text from visual novels. Learn text hooking, configure extensions, integrate with JL/Yomitan dictionaries, and troubleshoot common issues.
---

# Textractor Guide

This guide walks you through setting up **Textractor** and connecting it to a browser-based UI using the **WebSocket extension**. Ideal for reading and mining from Japanese visual novels using Yomitan in your browser.

---

## Requirements

- [Textractor (Chenx221's fork)](https://github.com/Chenx221/Textractor)
- [WebSocket Extension (kuroahna)](https://github.com/kuroahna/textractor_websocket)

### Integration Options
- [Texthooker UI (Renji-XD)](https://renji-xd.github.io/texthooker-ui/)
- [JL](jl-guide.md)

---

## Step 1: Set Up Textractor

1. Download Textractor from [Chenx221's GitHub](https://github.com/Chenx221/Textractor). (On the releases tab, you will find a list of files that go texthook_xxxxxx.7z. Get the newest one listed as "Textractor (仅英语)")
2. Extract the `.zip` file.
3. You will see two folders: `x86` and `x64`. These correspond to 32-bit and 64-bit versions of Textractor.
    - Use `x86` for most games.
    - Use `x64` for modern visual novels that don't work with the x86 version.

---

## Step 2: Install the WebSocket Extension

Download the WebSocket extension from the [Releases page](https://github.com/kuroahna/textractor_websocket/releases) of the `kuroahna/textractor_websocket` repository.

### File Setup

1. Unzip the release package.
2. Copy `textractor_websocket_x86.dll` into your `Textractor/x86` folder.
3. Copy `textractor_websocket_x64.dll` into your `Textractor/x64` folder.

### Add Extensions to Textractor

#### For `x86`:

1. Open `Textractor/x86/Textractor.exe`
2. Click the **Extensions** button (left sidebar).
3. Right-click in the Extensions window → **Add Extension**
4. In the file picker:
   - Change the file type to `*.dll`
   - Select `textractor_websocket_x86.dll`

#### For `x64`:

1. Open `Textractor/x64/Textractor.exe`
2. Repeat the same steps above using `textractor_websocket_x64.dll`

> **Tip:** You can remove any unhelpful extensions (like extra new lines) from your Extensions list. My settings are provided below for reference.

![My Textractor Settings](assets/texthooking.png)
<div style="text-align:center; font-size: 0.95em; color: #666; margin-bottom: 1em;"><em>Textractor with the WebSocket extension loaded (Extensions window)</em></div>

---

## Step 3: Hook the Visual Novel

1. Launch your visual novel and get to a point where you can start loading text.
2. Open the matching version of **Textractor** (`x86` or `x64`) based on your game.
3. In Textractor, click "Attach to game" in the top-left to open the process list.
4. Select the visual novel’s process.

    > 🛠 If the game doesn’t appear in the list, try running Textractor as Administrator.

5. Advance the VN by a few lines to generate text for Textractor to capture.
6. Use the top dropdown in Textractor (where it says "Console") and press up and down to cycle through the hooks.
7. Find a hook that accurately reflects the game's text.

![Textractor UI](assets/texthooking2.png)

If textractor can't automatically find a working hook, you can try searching manually by selecting "Search for hooks" or checking the discussion tab of the game's VNDB page to see if anyone has listed a working hook code.

---

## How to View Text in the Browser

1. Open [Renji-XD’s Texthooker UI](https://renji-xd.github.io/texthooker-ui/) in your browser. If the WebSocket is working, the colored icon in the top right should be green. If it's still red, trying clicking on it to reconnect.
2. Click the **Start** button in the top-right corner. (Or enable "Allow new Line during Pause" and "Autostart Timer by Line during Pause" in the settings.)
3. Once Textractor is hooked and sending text, the UI will display it in real time.
4. The WebSocket server will be automatically started by Textractor at:

    `ws://localhost:6677`

> This allows the texthooker UI to receive text directly from Textractor using the WebSocket extension.

![Successful Websocket Conenction](assets/texthooking3.png){: style="display: block; margin: 1.5em auto 2em auto; width: 300px;" }
<div style="text-align:center; font-size: 0.95em; color: #666; margin-bottom: 1em;"><em>This is what a successful WebSocket connection looks like (icon is green)</em></div>

---

## Useful Regex Patterns

Below are common regular expressions you can use to clean up text captured by Textractor. These patterns can be used with the Textractor "Regex Filter" and "Regex Replacer" extensions, texthooking pages, or any text processing tool that supports regex.

!!! tip "Test Your Patterns"
    Use [RegExr](https://regexr.com/) to test and refine these patterns with your specific examples before applying them.

### 1. Remove bracketed speaker tags

Example: `【太郎】こんにちは` → `こんにちは`

```regex
^\s*[【\[][^】\]]+[】\]]\s*
```

### 2. Remove everything before a name tag

Example: `garbage【太郎】こんにちは` → `【太郎】こんにちは`

```regex
^.*?(?=[【\[][^】\]]+[】\]])
```

### 3. Strip ruby/furigana

Example: `今日《きょう》です` → `今日です`

```regex
《[^》]+》
```

Keep base text with leading pipe: `｜今日《きょう》` → `今日`
```regex
｜([^《]+)《[^》]+》
```
Replace with: `$1`


### 4. Remove timestamps

Example: `[00:01:23]こんにちは` → `こんにちは`

```regex
^\s*[\[\(]?\d{1,2}:\d{2}(?::\d{2})?[\]\)]?\s*
```

### 5. Normalize spaces and newlines

Example: `こんにちは　世界` → `こんにちは 世界`

```regex
\u3000
```
Replace with: ` ` (single space)

Collapse repeated newlines:
```regex
\n{2,}
```
Replace with: `\n\n`

### 6. Remove control characters

Example: Remove invisible control characters

```regex
[\x00-\x1F\x7F]+
```

!!! warning "Edge Cases"
    - Names that include punctuation (will be matched by the simple name patterns)
    - Games using non-standard brackets or custom markup
    - Make sure to test patterns on sample text before you continue reading

---

## Additional Tips

- Keep both `x86` and `x64` folders ready — the version depends on the VN.
- Some games may not hook correctly if you set Textractor to automatically use a saved hook. Try restarting the game or clicking "Forget game".
- If you don’t see text in the UI, check that:
      - The WebSocket extension is installed correctly.
      - Textractor is actually hooked to the VN.
      - You're using a supported browser (Chrome, Firefox, Brave etc.).
      - Your firewall settings and browser extensions aren't blocking the WebSocket connection.

---

## Related Pages

**Getting Started & Learning:**

- [Complete Beginner's Guide](guide.md) – Full roadmap for learning Japanese with VNs
- [Mining Vocabulary Section](guide.md#building-vocabulary-through-mining) – How to mine words efficiently

**Dictionary & Mining Integration:**

- [JL Dictionary Setup](jl-guide.md) – Pop-up dictionary + Anki mining
- [Tools Overview](tools.md) – Summary of all recommended tools

**Alternative Text Acquisition:**

- [Agent Guide](agent-guide.md) – Script-based advanced text hooking (use when Textractor struggles)
- [OwOCR Guide](owocr-guide.md) – OCR fallback for unhookable games

**Finding Visual Novels:**

- [Where to Get VNs](sources.md) – Download sources
- [Finding VNs on VNDB](find.md) – Discover and choose new titles

