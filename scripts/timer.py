import tkinter as tk
import time
import keyboard  # Requires: pip install keyboard
import threading

class TransparentTimer:
    def __init__(self):
        self.root = tk.Tk()
        self.root.attributes("-topmost", True)
        self.root.overrideredirect(True)
        self.root.attributes("-transparentcolor", "black")
        self.root.config(bg="black")

        # Initial Display
        self.label = tk.Label(self.root, text="00:00:00.000", font=("Consolas", 40, "bold"),
                              fg="cyan", bg="black")
        self.label.pack()

        # State variables
        self.running = False
        self.start_time = 0

        # Draggable logic
        self.label.bind("<Button-1>", self.start_move)
        self.label.bind("<B1-Motion>", self.do_move)
        self.label.bind("<Double-Button-1>", lambda e: self.root.destroy())

        # Setup Global Hotkey (F7)
        # Using a thread to prevent the hotkey from blocking the GUI
        keyboard.add_hotkey('f7', self.toggle_timer)

        self.update_loop()
        self.root.mainloop()

    def toggle_timer(self):
        if not self.running:
            self.start_time = time.time()
            self.running = True
        else:
            # Optional: Reset if pressed again, or just leave as is
            self.running = False

    def update_loop(self):
        if self.running:
            elapsed = time.time() - self.start_time
            mins, secs = divmod(elapsed, 60)
            hours, mins = divmod(mins, 60)
            ms = int((elapsed % 1) * 1000)
            self.label.config(text=f"{int(hours):02}:{int(mins):02}:{int(secs):02}.{ms:03}")

        # Check for updates every 10ms
        self.root.after(10, self.update_loop)

    def start_move(self, event):
        self.x = event.x
        self.y = event.y

    def do_move(self, event):
        x = self.root.winfo_x() + (event.x - self.x)
        y = self.root.winfo_y() + (event.y - self.y)
        self.root.geometry(f"+{x}+{y}")

if __name__ == "__main__":
    TransparentTimer()
