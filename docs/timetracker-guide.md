---
description: VNTimeTracker setup guide for tracking your visual novel reading progress. Monitor time spent reading Japanese VNs and display your learning statistics.
---

# VNTimeTracker Guide

VNTimeTracker is a simple Python application designed to help you read more by accurately tracking your time spent reading visual novels.

![Time tracker main window](assets/VNTimetracker1.webp){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

---

## Installation

### Download Options

You have two options for getting VNTimeTracker:

#### Option 1: Download Binary (Recommended)

Download the latest binary from the [releases tab](https://github.com/drinosaret/VNTimeTracker/releases) and simply run the executable file.

#### Option 2: Run from Source

Clone the repository and install dependencies:

```bash
git clone https://github.com/drinosaret/VNTimeTracker.git
cd VNTimeTracker
pip install -r requirements.txt
```

Run the application:

```bash
python run.py
```

## Initial Setup

### Prerequisites

Before starting, ensure you have:

- The Japanese visual novel you want to track ready to launch (Check the [sources](sources.md) list for information on finding untranslated Japanese games)

### Global Settings Configuration

Before you start tracking, configure the global settings to suit your needs:

- **Daily Goal Time**: Set your target reading time per day
- **AFK Threshold**: Determines how long the timer waits before stopping when no activity is detected
- **Language Settings**: Choose between English or Japanese for the UI

## Setting Up Game Tracking

### Step-by-Step Process

1. **Launch your game**: Open the visual novel you want to track first
2. **Open VNTimeTracker**: Start the time tracker application
3. **Search for your VN**: Under "VN Search," search for the VN you are playing and select the correct title

    !!! info "Can't find your VN?"
        If you don't see your VN, search for it on [VNDB](https://vndb.org/) and make sure you are using the correct title. If the game you are playing is not on VNDB, consider adding it to the database.

4. **Select the process**: Choose the process name (it should be the filename of the exe you ran to start the game)
   - If you don't see it, try pressing the refresh button
5. **Start tracking**: Once you have selected both the game and process, click "Select Game and Process" to begin

## Using the Tracker

### Status Indicators

If things are configured correctly, both the timer in the main window and the overlay should increase when you are in the window of the game you are tracking.

**Color Code:**

- **Green**: Active (in-game and actively reading)
- **Yellow**: AFK (in-game, but not active)
- **Red**: Away (out-of-game)

### Customization Options

You can customize the tracker interface to suit your preferences:

- **Overlay opacity**: Change the opacity of the overlay window or disable it completely
- **Minimize to tray**: The main window can be minimized to the system tray if you find it distracting
- **Window layout**: Click in the middle of the window and drag to enlarge or hide the left or right components, allowing you to display only one side in the main window if desired

![Main window alternate view](assets/VNTimetracker2.webp){: style="display: block; margin: 1.5em auto 2em auto; width: 500px;" }

---

For any other questions or issues, you can check the [GitHub repository](https://github.com/drinosaret/VNTimeTracker) for more information or to open an issue.

---

## Related Pages

**Getting Started:**

- [Complete Beginner's Guide](guide.md) - Full roadmap for learning Japanese with VNs
- [Where to Get VNs](sources.md) - Find Japanese visual novels to track

**Essential Setup:**

- [Textractor Guide](textractor-guide.md) - Text hooking for reading VNs
- [JL Dictionary Guide](jl-guide.md) - Dictionary setup for lookups
- [Tools Overview](tools.md) - See all available VN reading tools

**More Resources:**

- [Where to Find VNs](find.md) - Discover new visual novels on VNDB
