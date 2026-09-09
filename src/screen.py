import platform

def get_screen_size():
    os_name = platform.system()

    if os_name == "Darwin":
        # macOS
        from AppKit import NSScreen

        screen = NSScreen.mainScreen()
        frame = screen.frame()

        width = int(frame.size.width)
        height = int(frame.size.height)

        scale = screen.backingScaleFactor()
        print("macbook scale factor = ", scale)
        return int(width * scale), int(height * scale)

    elif os_name == "Windows":
        # Windows
        from screeninfo import get_monitors

        monitor = get_monitors()[0]

        return monitor.width, monitor.height

    else:
        raise RuntimeError(
            f"Unsupported operating system: {os_name}"
        )
        
def setup_calibration_window(
    window_name,
    screen_width,
    screen_height
):
    import cv2

    cv2.namedWindow(
        window_name,
        cv2.WINDOW_NORMAL
    )

    # 화면에서 사용할 창 크기
    window_width = int(screen_width * 0.95)
    window_height = int(screen_height * 0.90)

    cv2.resizeWindow(
        window_name,
        window_width,
        window_height
    )

    # 화면 중앙에 배치
    x = (screen_width - window_width) // 2
    y = (screen_height - window_height) // 2

    cv2.moveWindow(
        window_name,
        0,
        0
    )
    
    # if platform.system() == "Darwin":
    #     # macOS
    #     window_width = int(screen_width * 0.95)
    #     window_height = int(screen_height * 0.90)

    #     cv2.resizeWindow(
    #         window_name,
    #         window_width,
    #         window_height
    #     )

    #     x = (screen_width - window_width) // 2
    #     y = (screen_height - window_height) // 2

    #     cv2.moveWindow(
    #         window_name,
    #         x,
    #         y
    #     )
