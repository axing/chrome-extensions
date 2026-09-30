# Middle Drag Scroll

Hold the middle mouse button and move the pointer up or down to scroll. The pointer can start
anywhere in a scrollable web page or panel. Movement follows the scrollbar thumb: dragging down
scrolls down, and dragging up scrolls up. Release the button to stop.

A middle click without a drag keeps its usual action, such as opening a link in a background tab.
The drag begins after the pointer moves five pixels. The extension replaces Chrome's built-in
middle-click autoscroll on scrollable pages.

The extension runs on ordinary web pages, including frames. Chrome does not allow extensions to
run on browser pages such as `chrome://settings` or in the browser toolbar.

## Permissions

The extension uses a content script on all web pages so the gesture works wherever you browse.
Chrome shows this as access to read and change data on websites. The script only listens for
mouse events and changes the scroll position. It does not read, save, or send page content.

## Install

1. Download `middle-drag-scroll.zip` from the [latest
   release](https://github.com/axing/chrome-extensions/releases/download/latest/middle-drag-scroll.zip).
2. Unzip it into a folder you intend to keep.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select
   the unzipped folder.
