---
description: Agent text hooker setup guide for visual novels and emulated games. Configure script-based text extraction when standard text hookers fail.
---

# Agent Guide

This guide walks you through setting up and using **Agent**, a universal script-based text hooker powered by FRIDA. Agent is designed for extracting text from visual novels and games across various platforms including PC games, emulators, and Unity games. Despite the simple UI, Agent is a powerful tool for hooking games that might not work with textractor.

![Agent window](assets/agent1.png){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

---

## Requirements

- [Agent](https://github.com/0xDC00/agent/releases) (Latest release)
- Target game or application
- Internet connection (for script updates)

---

## Installation

### Download and Setup

1. **Download Agent**: Visit the [releases page](https://github.com/0xDC00/agent/releases) and download the latest version
2. **Extract**: Unzip the downloaded file to a folder of your choice

### First Launch

1. Run `agent.exe` to start the GUI
2. Agent will automatically download and sync scripts from the [scripts repository](https://github.com/0xDC00/scripts)
3. Under the settings tab, ensure that "Machine Translate" is disabled and that either the websocket server or clipboard output is enabled

![Agent settings](assets/agent5.png){: style="display: block; margin: 1.5em auto 2em auto; width: 400px;" }

---

## Usage

### Basic Operation

1. **Select Target**: To select a target, you can supply a file directory to an exe file or you can more simply click and drag the target icon on to your target game. Clicking the dropdown menu next to the target icon and selecting "Create Process" will bring up a file picker allowing you to select a target.
   ![Agent target icon](assets/agent2.png){: style="display: block; margin: 1.5em auto 2em auto; width: 200px;" }
   ![Agent target icon drag](assets/agent3.png){: style="display: block; margin: 1.5em auto 2em auto; width: 400px;" }
2. **Apply Script**: In the window next to the "<>" icon, you can select the appropriate script for your game. You can search by name or platform. Clicking on the "<>" icon will bring up a file picker, allowing you to add a custom script
3. **Text Extraction**: Press the "Attach" button and text will be hooked and displayed in real-time

### Command Line Support

Agent also supports command-line operation for advanced users:

```bash
agent.exe [options] [target]
```

---

## Script Management

### Automatic Updates

- Scripts are automatically synced from the [official repository](https://github.com/0xDC00/scripts)
- New scripts and updates are downloaded automatically

### Custom Scripts

- User scripts are stored in the `data/scripts` folder
- You can add custom scripts for unsupported games
- Scripts use JavaScript

---

## Additional Resources

- **GitHub Repository**: [https://github.com/0xDC00/agent](https://github.com/0xDC00/agent)
- **Scripts Repository**: [https://github.com/0xDC00/scripts](https://github.com/0xDC00/scripts)
- **Script Requests**: Open an issue on the [issues tab](https://github.com/0xDC00/scripts/issues)
- **Video Tutorials**: [YouTube Playlist](https://www.youtube.com/watch?v=dFfuq2UnKjU&list=PLTZXVVG9AT6Sbl1Yg42sxzVAS6IMfnaNH&index=2)

---

## Related Pages

**Primary Text Hooking:**

- [Textractor Guide](textractor-guide.md) - Standard text hooker (try this first)
- [Complete Beginner's Guide](guide.md) - Full learning roadmap

**When Text Hooking Fails:**

- [OwOCR Guide](owocr-guide.md) - OCR alternative for untexthookable games

**Next Steps:**

- [JL Dictionary Setup](jl-guide.md) - Connect text hooker to dictionary
- [Where to Get VNs](sources.md) - Find games to practice with
- [Tools Overview](tools.md) - See all available tools
  
---
