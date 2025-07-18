# JL Guide

This page offers directions on how to set up and use the [JL](https://github.com/rampaa/JL) pop-up dictionary.

!!! note
    JL is best paired with a texthooker for extracting text from games or applications. For more information on texthookers and setup, see [this guide on texthooking](texthooking-guide.md).

![JL](assets/JL.webp)

---

## Preliminary Setup

### Downloading JL

First, download JL from its GitHub repository:

1. Navigate to the [Releases](https://github.com/rampaa/JL/releases) tab
2. Under "Assets," download the version that matches your system architecture

!!! warning
    This program is only intended to run on Windows systems.

![download link](assets/JL2.png)

### Downloading Dictionaries

Next, make sure that you have downloaded the dictionaries you intend to use with JL:

- **Built-in dictionaries**: JL automatically comes with bilingual dictionaries such as JMdict, Kanjidic, and Jmnedict, which you can update from within the program
- **Additional dictionaries**: Other dictionaries, such as monolingual dictionaries like 大辞林, must be manually imported
- **Supported formats**: JL supports dictionaries made in both Yomitan and Nazeka formats, but most users will be using Yomitan dictionaries

A large collection of compatible dictionaries can be found in [Marv's Yomitan Dictionaries](https://github.com/MarvNC/yomitan-dictionaries) collection. Scroll down to "Dictionary Collection," where you will find a [Google Drive](https://drive.google.com/drive/folders/1LXMIOoaWASIntlx1w08njNU005lS5lez) link that contains all dictionaries in the collection. You can download the entire collection or just the dictionaries you intend to use.

## Basic Configuration

### Initial Setup

Once you have downloaded both the main JL program and the dictionaries you intend to use:

1. Extract JL into its own folder
2. Start the program by running `JL.exe`
3. When prompted, select "yes" to download Kanjidic, JMnedict, and JMdict automatically

### Window Configuration

Now you will be able to see the main JL window on your desktop. You can:

- **Move and resize**: Click and drag the window to change its position and resize it however you like
- **Adjust opacity**: Click the first icon in the top left to reveal a slider for window opacity
- **Adjust text size**: Click the "T" icon to adjust the size of the text

![JL in action](assets/JL3.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

### Text Input Configuration

Before we start importing additional dictionaries, let's first make sure that the program can receive text either from the clipboard or from a websocket:

**Clipboard capture (default)**: By default, JL receives text from the clipboard, so by copying any text to your clipboard, you will be able to verify that it is working.

**WebSocket capture**: If you have configured [Textractor](https://github.com/Chenx221/Textractor) or another texthooker to automatically copy text to the clipboard, the JL window will automatically be populated with the extracted text. If you are making use of a websocket with your texthooker, you can enable JL to receive text from it:

1. Right-click on the main JL window
2. Open preferences
3. Under "Main Window," enable "Enable WebSocket text capture"

The websocket server address that you need to use will differ depending on the plugin or program you are using, but the default of `ws://127.0.0.1:6677` will work with [textractor_websocket](https://github.com/kuroahna/textractor_websocket).

![Websocket settings](assets/JL4.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

## Basic Functionality

### Default Interface

Once JL is receiving text from the clipboard or websocket, you can use it as a pop-up dictionary. By default, the "lookup mode" (found under "General" in preferences) is set to "mouse move." Just move your mouse over a word to look it up.

**Dictionary entry display**: Each dictionary entry displays:

- The word and its reading
- A speaker icon (for pronunciation if available)
- A frequency number
- The dictionary name
- A plus icon to add the word to Anki
- The definition content

**Mining mode**: The pop-up will show the most relevant results, but sometimes not all results fit in the window. To see everything, enter "Mining mode" by either:

- Pressing the `Alt+M` hotkey
- Clicking the middle mouse button (more convenient)

In mining mode, you will be able to scroll through the full list of results. By default, it will show results from all dictionaries, but you have the option to filter by dictionary by selecting the name of the dictionary at the top of the window.

### Other Lookup Modes

**Mouse click/Touch**: Disables the preview screen that appears when mousing over the text and brings you straight into the full list of dictionaries whenever you click on a word with your mouse. As the name implies, this setting is also useful for touchscreens, allowing you to easily look up words by simply tapping on them.

**Text Select**: Requires you to click and drag to highlight the text that you want to look up, bringing you straight into mining mode.

![Mining mode example](assets/JL5.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

## Adding Additional Dictionaries

### Preparation

Before you start adding dictionaries to JL:

1. Create a new folder to hold the dictionaries you wish to use
2. Extract each dictionary's zip file to its own folder
3. Ensure the index and term bank JSON files of each dictionary are found at the root of each extracted folder

![Folder directory](assets/JL6.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

### Adding Word Dictionaries

Additional dictionaries can be added to JL:

1. Right-click on the main window and select "Manage dictionaries"
2. From the new window that pops up, select "Add dictionary" from the top
3. Select a dictionary format and type

**Dictionary types**: Assuming you are using Yomitan format dictionaries, you can leave the format as is for now and select a type. Conveniently, dictionaries from Marv's collection are labeled by type, so depending on the label, you will know which to select. Dictionaries listed as `[JA-JA]` and `[JA-EN]` can be added as word dictionaries.

![Add dictionary screen](assets/JL7.png)

### Understanding Kanji Dictionary Types

One thing you need to pay attention to is the difference between a dictionary listed as "Kanji Dictionary" and "Kanji Dictionary with Word Schema." Both will appear under JL's "Kanji Mode" whenever the associated hotkey (`Alt+K` by default) is pressed. However:

- **Kanji Dictionary**: Dictionaries that appear under the kanji tab of Yomitan (the window that opens when you click on a specific kanji) should be added as "Kanji Dictionary"
- **Kanji Dictionary with Word Schema**: Dictionaries that are still technically for kanji but appear among regular dictionary entries should be added as "Kanji Dictionary with Word Schema"

!!! tip "Identifying Dictionary Types"
    You can also check the extracted file directory to determine the dictionary type:

    - **Kanji Dictionary**: Contains files titled `kanji_bank_1.json`, `kanji_bank_2.json`, etc.
    - **Kanji Dictionary with Word Schema**: Contains files titled `term_bank_1.json`, `term_bank_2.json`, etc.

| ![Kanji Dictionary Example](assets/JL8.png){ width="300" } | ![Kanji Dictionary Word Scheme Example](assets/JL9.png){ width="300" } |
|:---:|:---:|
| **Add as Kanji Dictionary**<br>*Shows in kanji tab only* | **Add as Kanji Dictionary with Word Schema**<br>*Shows among word entries* |

Similarly, only dictionaries added as name dictionaries will come up when the associated hotkey to trigger "Name mode" is pressed. You can see the full list of "modes" with their associated default hotkeys below.

![Modes](assets/JL10.png)

### Dictionary Configuration

**Adding your dictionary**:

1. Add the path to where you extracted it to "Path"
2. Under "Name," give it a unique identifier
3. Configure the three available options:
    - **Storage**: Store dictionary data in either a database or memory (database is recommended for most users as it reduces memory usage)
    - **Newline between definitions**: Controls whether each definition appears on a new line for better readability
    - **Don't show results under all**: Hides this dictionary's results when viewing the combined results from all dictionaries
4. Click "OK" to add the dictionary

**Organization**: Once you have added your dictionaries, you will be able to organize them however you want by pressing the up and down arrows to the left of the name of each dictionary. Additionally, you will be able to edit the previous settings for each dictionary at any time.

!!! info
    The dictionaries that were automatically installed at the start may have some special settings. One of note is the option to automatically check for updates after a set number of days.

![Special Settings](assets/JL11.png){: style="display: block; margin: 1.5em auto 2em auto; width: 300px;" }

### Adding Frequency Dictionaries

To add frequency dictionaries, you must add them separately through a different window:

1. Return to the main window, right-click, and open "Manage Frequencies"
2. Select whether the frequency dictionary is for words (appears with normal definitions in Yomitan) or for Kanji (only appears on the Kanji tab)
3. Pay attention to the last option, which should be checked in the case that you have a frequency dictionary where the frequency number actually lists occurrences rather than a ranking where a smaller number indicates the word or kanji being more frequent

Most frequency dictionaries use a ranking format, so you should be able to leave this setting alone.

![Frequency setting](assets/JL12.png){: style="display: block; margin: 1.5em auto 2em auto; width: 300px;" }

## Adding Audio Sources

To begin adding audio sources:

1. Return to the main menu, right-click on the window, and select "Manage Audio Sources"
2. Click the button at the top labeled "Add audio source"
3. You can now add audio sources just like you would in Yomitan

### Local Audio Server

If you are using the [Local Audio Server](https://github.com/yomidevs/local-audio-yomichan) for Yomitan:

- Set the audio type to `URL (JSON)`
- Use the following URL:

  ```url
  http://127.0.0.1:5050/?sources=jpod,jpod_alternate,nhk16,forvo&term={Term}&reading={Reading}
  ```

### Online Sources

Online sources like JapanesePod101 can be added in a similar manner:

- Set the audio type to `URL`
- Enter a URL (this one should already be there by default):

  ```url
  http://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={Term}&kana={Reading}
  ```

### Text-to-Speech

Additionally, you can add any text-to-speech engines that you have installed on your system.

![Example audio sources](assets/JL13.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

## Enabling Anki Integration

!!! info "Prerequisite"
    If you don't already have Anki configured, I suggest you take a look at this page from [Kuri's guide](https://donkuri.github.io/learn-japanese/setup/#anki-setup/) for more information.

### Basic Setup

To be able to mine words with JL, you need to configure some additional settings:

1. Right-click on the main window, click on preferences
2. Navigate to the "Anki" tab
3. Enable the setting labeled "Enable Anki integration"

Assuming you have [AnkiConnect](https://ankiweb.net/shared/info/2055492159) installed, the default server address should work just fine.

![Anki tab](assets/JL14.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

### Deck Configuration

The lower part of the window where you can start configuring your Anki cards will now be open:

1. **Select your deck**: If you don't see your decks after clicking on the dropdown window under "Deck," try clicking the "Refresh" button until they appear
2. **Choose note type**: Under "Note Type," select the note type that your cards will use
3. **Configure fields**: Select **Get Fields** if they have yet to appear

Once the fields of your card appear, you can start configuring your cards however you like. The information you need to send to each field will depend entirely on the note type you are using.

### Field Configuration Reference

If you click on the **Info** button, you will get the following list of the applicable settings:

| Field Name | Description |
| --- | --- |
| Selected Spelling | The primary spelling or the selected reading you click to mine the word. |
| Primary Spelling | The spelling you click to mine the word, e.g., if you look up "わかりました", its primary spelling will be "分かる". |
| Primary Spelling with Orthography Info | The spelling you click to mine the word with its orthography info, e.g., if you look up "珈琲", its value will be "珈琲 (ateji)". |
| Readings | Readings of the mined word, e.g., if you look up "従妹", its value will be "じゅうまい、いとこ". |
| Selected Reading | If you selected a reading to mine the word, it will be that reading; otherwise, it will be the first reading of the mined word. |
| Readings with Orthography Info | Readings of the mined word with their orthography info, e.g., if you look up "従妹", its value will be "じゅうまい、いとこ (gikun)". |
| Alternative Spellings | Alternative spellings of the mined word, e.g., if you look up "わかりました", its value will be "解る、判る、分る". |
| Alternative Spellings with Orthography Info | Alternative spellings of the mined word with their orthography info, e.g., if you look up "嫁", its value will be "娵 (rK)、婦 (rK)、媳 (rK)". |
| Definitions | Definitions of the mined word. You can edit the definitions in the popup window by pressing Insert and clicking on the definitions text box with the left mouse button. |
| Definitions from Multiple Dictionaries | Definitions for the mined word from word dictionaries. |
| Selected Definitions | The selected text in the definition text box. If no text is selected, it will have the same value as the "Definitions" field. |
| Primary Spelling and Readings | Primary spelling and its readings in the format `Primary Spelling[Reading 1]、Spelling[Reading 2]、...、Spelling[Reading N]`, e.g., 俺[おれ]、俺[オレ]、俺[おらあ]、俺[おり]. |
| Primary Spelling and Selected Reading | Primary spelling and its first reading in the format `Primary Spelling[Selected Reading]`, e.g., 俺[おれ]. |
| Dictionary Name | Name of the dictionary, e.g., JMDict. |
| Audio | Audio for the 'Selected Reading' of the mined word. |
| Image | Image found in clipboard at the time of mining. |
| Source Text | Whole text in which the mined word appears. |
| Leading Source Text Part | Part of the source text that appears before the matched text. |
| Trailing Source Text Part | Part of the source that appears after the matched text. |
| Sentence | Sentence in which the mined word appears. |
| Leading Sentence Part | Part of the sentence that appears before the matched text. E.g., if the mined word is "大好き" in "妹が大好きです", this will be "妹が". |
| Trailing Sentence Part | Part of the sentence that appears after the matched text. E.g., if the mined word is "大好き" in "妹が大好きです", this will be "です". |
| Matched Text | Text the mined word was found as, e.g., "わかりました". |
| Deconjugated Matched Text | Matched Text's deconjugated form, e.g., if the "Matched Text" is "わかりました", this will be "わかる". |
| Deconjugation Process | Deconjugation path from the "Matched Text" to "Deconjugated Matched Text". |
| Word Classes | Part-of-speech info for the mined word, e.g., if the mined word is 電話, this will be "n, vs, vt, vi". |
| Frequencies | Frequency info for the mined word, e.g., "VN: 77, jpdb: 666". |
| Raw Frequencies | Raw frequency info for the mined word, e.g., "77, 666". |
| Preferred Frequency | Frequency info for the mined word from the frequency dictionary with the highest priority, e.g., "666". |
| Frequency (Harmonic Mean) | Harmonic mean of the raw frequencies, e.g., "666". |
| Pitch Accents | Pitch accents for the mined word, displayed in a similar fashion to how pitch accents are shown in a JL popup. |
| Pitch Accents (Numeric) | Pitch accents for the mined word in numeric form, e.g., "おんな: ３, おみな: 0, おうな: 1". |
| Pitch Accent for Selected Reading | Pitch accent for the 'Selected Reading' of the mined word, displayed in a similar fashion to how pitch accents are shown in a JL popup. |
| Pitch Accent for Selected Reading (Numeric) | Pitch accent for the 'Selected Reading' of the mined word in numeric form, e.g., "おんな: 3". |
| Pitch Accent Categories | Pitch accent categories for the mined word, e.g., "にほんご: Heiban, にっぽんご: Heiban". There are currently four pitch accent categories: Heiban, Atamadaka, Odaka, and Nakadaka. |
| Pitch Accent Category for Selected Reading | Pitch accent category for the 'Selected Reading' of the mined word, e.g., "にほんご: Heiban". There are currently four pitch accent categories: Heiban, Atamadaka, Odaka, and Nakadaka. |
| Entry ID | JMDict entry ID. |
| Local Time | Mining date and time expressed in local timezone. |

### Example Configuration

For reference, I've provided some basic settings that will work with the lapis note type for Anki below:

![Anki settings: part 1](assets/JL15.png){: style="display: block; margin: 1.5em auto 2em auto; width: 600px;" }
![Anki settings: part 2](assets/JL16.png){: style="display: block; margin: 1.5em auto 2em auto; width: 600px;" }

## Additional Settings

The above information covers everything that you need to get started, but JL is a highly customizable program. Here are some additional settings in the preferences menu that might be of interest:

### General Settings

- **Theme**: You can change the theme of the settings menus from dark mode to light mode if you wish
- **Lookup requires Lookup Key press**: If you are used to having to press a key on your keyboard to look up a word, you can set it under "Lookup Key." Personally, I enjoy the mouse-only flexibility of JL, so I keep this option unchecked
- **Auto-play audio**: This will automatically play the pronunciation of a word whenever you look it up. It might be a bit annoying in mouse move mode

### Main Window Settings

- **Font**: You can set the font to any that you have installed on your system
- **Dynamic width/Dynamic height**: Automatically changes the size of the main window to fit all text in it. You can disable this if you find it annoying
- **Auto reconnect to WebSocket**: It's probably useful to turn this on if you are using WebSocket
- **Opacity/Opacity on unhover**: You can set default values for the opacity of the main window when your mouse is on top of it and when it isn't. Personally, I have the opacity set to 100 when it is and set to a low value when it isn't, so that the window is less of a distraction when I'm not using it. (Make sure to enable "Change opacity on unhover" if you wish to emulate this.)
- **Text only visible on hover**: Similar to the opacity settings, enabling this will help make the window less conspicuous when you aren't actively using it. I usually have this enabled
- **Text-to-speech on text change**: This will make JL read out every single line to you. If you can't tolerate the default Windows TTS engines, consider trying out a high-quality one like [Voicevox](https://github.com/VOICEVOX/voicevox/releases)

### Popup Settings

- **Font**: You can also set a custom font for the popup. It can be different from or the same as the one you set for the main window

### Advanced Settings

- **Track the lookup count of each term**: Tracks how many times you have looked up each word. This is visible in the stats menu by pressing the button next to "Number of lookups"
- **Search URL**: You can change the search feature (pressing the S key, or selecting search from the right-click menu after highlighting text) to use a search engine other than Google. Just take any search query and replace the search term with `{SearchTerm}` in the URL

---

For any other questions or issues, you can check the [JL GitHub repository](https://github.com/rampaa/JL) for more information or to open an issue.
