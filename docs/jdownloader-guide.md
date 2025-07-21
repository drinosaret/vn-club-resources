# JDownloader Guide

This guide walks you through setting up and using **JDownloader** and the **Download with JDownloader** browser extension to help improve your experience with DDL sites.

---

## Requirements

- [JDownloader](https://jdownloader.org/download/index) (Latest release)
- Download with JDownloader extension (Optional but recommended):
      - [Chrome/Edge](https://chromewebstore.google.com/detail/download-with-jdownloader/jfpmbokkdeapjommajdfmmheiiakdlgo)
      - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/download-with-jdownloader/)

![Download page](assets/jdownloader1.png)

---

## Installation

1. **Download JDownloader**: Visit the [official homepage](https://jdownloader.org/download/index) and choose the release that works on your operating system
2. **Install the program**: Follow the installation instructions for your platform

---

## Basic Configuration

Once you have installed the program, open it and you will be taken to the main window of the GUI. Before we start downloading anything, there are some settings that we should look over. Open the settings tab to start editing your settings.

### General Settings

1. Set your download folder under "Download Folder"
2. Ensure that "Group single files in a 'various package'" is enabled - this will make Jdownloader automatically handle loose files in a single package
3. Consider increasing the "Max. Chunks per Download" setting under "Download Management" to improve speeds
     - A setting of around 8 should generally work fine
     - Setting it too high may cause issues, so feel free to experiment

![Jdownloader General Settings](assets/jdownloader3.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

### Archive Extractor Settings

When enabled, JDownloader will automatically extract your downloaded files. You can either:

- Set it to extract in the same directory as where you downloaded your files
- Configure a different directory specifically for extracted content under "Extract destination folder"

![Jdownloader Extraction settings](assets/jdownloader2.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

### Advanced Settings

If you find the blinking clipboard icon annoying when you disable automatic link extraction from the clipboard, you can turn it off:

1. Go to the "Advanced Settings" tab
2. Search for "clipboard"
3. Set the value of "Tray: Tray Icon Clipboard Indicator" to false

### Adding a Premium Account (Optional)

If you're using a premium account or debrid service:

1. Go to the "Account Manager" tab in settings
2. First ensure that a host plugin under "Plugins" can be found for your specific service
3. Click "Add" and search for your host
4. Enter your login credentials in the window below
5. Click "Save" to save your details
6. If successful, your account should appear with a green checkmark under "Status"
7. Enable the lock icon at the top of the page to ensure JDownloader uses your premium account

![Top Menu Settings](assets/jdownloader4.png){: style="display: block; margin: 1.5em auto 2em auto; width: 300px;" }

---

## Basic Usage

### Adding Links

You can add links to JDownloader in several ways:

**Automatic Clipboard Capture:**

- Enable the clipboard option (clipboard icon at the top of the screen)
- Simply copy any link(s) and JDownloader will automatically add them to the LinkGrabber

**Manual Link Addition:**

1. Select "File" → "Analyse and Add Links"
2. Input your links in the top window
3. Press continue when ready

### Managing Downloads

1. **Package Management**: If you copied multiple parts from a split release, they should automatically be combined. If not, manually drag each part into the same package
2. **Configuration**: Before starting your download, configure:

    - Package properties
    - Save location
    - Archive password (for automatic extraction)
    - Auto extract settings
    - Priority settings
![Jdownloader downloads screen](assets/jdownloader5.png){: style="display: block; margin: 1.5em auto 2em auto; width: 600px;" }

3. **Start Download**: Right-click on the package and select "Start Downloads"
![Start Download](assets/jdownloader6.png){: style="display: block; margin: 1.5em auto 2em auto; width: 400px;" }

4. **Access Files**: When finished, on the downloads tab, right-click on your package and select "Open downloads directory"

---

## Download with JDownloader Extension

To streamline the process even further, you can install the browser extension.

### Extension Installation

1. **Install Extension**: Add the extension to your browser
2. **Setup**: Follow the installation instructions that appear
3. **Install Package**: You'll need to install a package with "install.bat"
   - Extract the package to its own directory
   - Run install.bat
   - Ensure the path to the executable is correct in the options tab

> **Video Guide**: [Installation tutorial for Windows](https://www.youtube.com/watch?v=yZAoy8SOd7o)

### Features

Once configured correctly, several features become available:

**Browser Integration:**

- Right-click context menu options
- Extension icon for enabling/disabling automatic downloads to JDownloader
![Context menu options](assets/Jdownloader7.png){: style="display: block; margin: 1.5em auto 2em auto; width: 400px;" }

**Useful Features:**

- **Download Link**: Send individual links to JDownloader without using clipboard
- **Download All Links**: Automatically get all links on a page and choose which to download
