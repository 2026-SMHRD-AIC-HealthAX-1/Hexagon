import cv2
import mediapipe as mp
import argparse
import time
import numpy as np

from calibration import Calibration
from gaze_game import GazeGame
from blink_monitor import BlinkMonitor

from gaze_region_classifier import (
    GazeRegionClassifier,
    load_calibration_samples,
    calculate_region_gaze,
    create_region_points
)

from screen import (
    get_screen_size,
    setup_calibration_window
)

from gaze import (
    GazeSmoother,
    compute_gaze,
)

MODEL_PATH = "models/face_landmarker.task"
SHOW_CAMERA = False

def parse_args():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--calibrate",
        action="store_true",
        help="Run calibration"
    )
    
    parser.add_argument(
        "--blink",
        action="store_true",
        help="Run blink monitoring mode"
    )

    return parser.parse_args()

def run_calibration():

    print("Starting calibration...")

    # 카메라
    cap = cv2.VideoCapture(0, cv2.CAP_AVFOUNDATION)
    
    if not cap.isOpened():
        print("카메라를 열 수 없습니다.")
        return

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print("cam width = ", width, "cam height = ", height)
    
    screen_width, screen_height = get_screen_size()
    print(f"Screen: {screen_width} x {screen_height}")
    
    setup_calibration_window(
        "Calibration",
        screen_width,
        screen_height
    )
    calibration = Calibration(
        screen_width,
        screen_height 
    )

    # MediaPipe Face Landmarker 설정
    BaseOptions = mp.tasks.BaseOptions
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=MODEL_PATH,
            delegate=BaseOptions.Delegate.CPU
        ),
        running_mode=VisionRunningMode.VIDEO,
        num_faces=1,
    )

    smoother = GazeSmoother(alpha=0.2)
    
    
    # Face Landmarker 생성
    with FaceLandmarker.create_from_options(options) as landmarker:

        print("Face Landmarker 시작")
        print("Q를 누르면 종료합니다.")

        frame_timestamp_ms = 0
        calibration.start() 
        
        while True:
            ret, frame = cap.read()

            if not ret:
                print("카메라 프레임을 읽을 수 없습니다.")
                break
            
            
            # OpenCV는 BGR → MediaPipe는 RGB
            rgb_frame = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2RGB
            )

            # MediaPipe Image 생성
            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=rgb_frame
            )

            # 얼굴 landmark 추론
            result = landmarker.detect_for_video(
                mp_image,
                frame_timestamp_ms
            )

            frame_timestamp_ms += 33

            # landmark 그리기
            if result.face_landmarks:

                h, w, _ = frame.shape
                
                for face_landmarks in result.face_landmarks:

                    gaze_x, gaze_y = compute_gaze(face_landmarks, smoother)

                    # Calibration용 빈 화면 생성
                    screen = np.zeros(
                        (screen_height, screen_width, 3),
                        dtype=np.uint8
                    )
                    
                    point = calibration.current_point()

                    cv2.rectangle(
                        screen,
                        (0, 0),
                        (screen_width - 1, screen_height - 1),
                        (255, 255, 255),
                        3
                    )
                    
                    if point is not None:

                        cv2.circle(
                            screen,
                            point,
                            15,
                            (0, 0, 255),
                            -1
                        )

                        elapsed = time.time() - calibration.start_time
                        
                        if 0.5 <= elapsed < 3.8:
                            calibration.add_sample(
                                gaze_x,
                                gaze_y
                            )
                            
                        if elapsed >= 4.0:
                            calibration.next_point()
                    
            if calibration.is_finished():
                calibration.save(
                    "data/calibration.json"
                )
                break;
                                            
            # cv2.imshow(
            #     "MediaPipe Face Landmarker",
            #     frame
            # )

            # Calibration 화면 출력
            cv2.imshow(
                "Calibration",
                screen
            )
            
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        cap.release()
        cv2.destroyAllWindows()


def run_game_mode():

    if not Calibration.exists("./data/calibration.json"):
        print(
            "Calibration data not found."
        )
        print(
            "Run: python src/main.py --calibrate"
        )
        return
    samples = load_calibration_samples(
        "data/calibration.json"
    )

    averages = calculate_region_gaze(
        samples
    )

    region_points = create_region_points(
        averages
    )

    classifier = GazeRegionClassifier(
        region_points
    )
    print("Calibration loaded.")

    # 카메라
    cap = cv2.VideoCapture(0, cv2.CAP_AVFOUNDATION)
    
    if not cap.isOpened():
        print("카메라를 열 수 없습니다.")
        return
    
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    print("cam width = ", width, "cam height = ", height)
    
    screen_width, screen_height = get_screen_size()
    print(f"Screen: {screen_width} x {screen_height}")
    
    setup_calibration_window(
        "Game",
        screen_width,
        screen_height
    )
    game = GazeGame(
        screen_width,
        screen_height
    )
    
    game.next_target()
    
    # MediaPipe Face Landmarker 설정
    BaseOptions = mp.tasks.BaseOptions
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=MODEL_PATH,
            delegate=BaseOptions.Delegate.CPU
        ),
        running_mode=VisionRunningMode.VIDEO,
        num_faces=1,
    )

    smoother = GazeSmoother(alpha=0.2)
    
    # Face Landmarker 생성
    with FaceLandmarker.create_from_options(options) as landmarker:

        print("Face Landmarker 시작")
        print("Q를 누르면 종료합니다.")

        frame_timestamp_ms = 0
        
        while True:
            ret, frame = cap.read()

            if not ret:
                print("카메라 프레임을 읽을 수 없습니다.")
                break

            # OpenCV는 BGR → MediaPipe는 RGB
            rgb_frame = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2RGB
            )

            # MediaPipe Image 생성
            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=rgb_frame
            )

            # 얼굴 landmark 추론
            result = landmarker.detect_for_video(
                mp_image,
                frame_timestamp_ms
            )

            frame_timestamp_ms += 33

            # landmark 그리기
            if result.face_landmarks:

                h, w, _ = frame.shape
                
                for face_landmarks in result.face_landmarks:

                    gaze_x, gaze_y = compute_gaze(face_landmarks, smoother)

                    gaze_region = classifier.predict(
                        gaze_x,
                        gaze_y
                    )
                    
                    success = game.check_gaze(gaze_region)
                    
                    screen = np.zeros(
                        (screen_height, screen_width, 3),
                        dtype=np.uint8
                    )
                    
                    if success:
                        game.handle_success()
                        
                    cv2.putText(
                        screen,
                        f"Score: {game.score}",
                        (30, 50),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.2,
                        (255, 255, 255),
                        3
                    )
                
                    cv2.putText(
                        screen,
                        f"Region: {gaze_region}",
                        (screen_width // 2 - 150, screen_height // 2),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0,
                        (255, 255, 255),
                        20
                    )
                    # cv2.putText(
                    #     frame,
                    #     f"Gaze X: {gaze_x:.2f}",
                    #     (30, 40),
                    #     cv2.FONT_HERSHEY_SIMPLEX,
                    #     0.8,
                    #     (255, 255, 255),
                    #     2
                    # )

                    # cv2.putText(
                    #     frame,
                    #     f"Gaze Y: {gaze_y:.2f}",
                    #     (30, 75),
                    #     cv2.FONT_HERSHEY_SIMPLEX,
                    #     0.8,
                    #     (255, 255, 255),
                    #     2
                    # )                   
                        
                    # cv2.putText(
                    #     frame,
                    #     f"{'LEFT' if gaze_x >= 0.52 else 'CENTER' if gaze_x >= 0.45 else 'RIGHT'}" ,
                    #     (960, 540),
                    #     cv2.FONT_HERSHEY_SIMPLEX,
                    #     0.8,
                    #     (255,0,0) if gaze_x >= 0.52 else (0,0,255) if gaze_x >= 0.45 else (0,255,0),
                    #     200
                    # )
            
            screen = game.draw(screen)
            
            if SHOW_CAMERA:                                
                cv2.imshow(
                    "Camera",
                    frame
                )

            cv2.imshow(
                "Game",
                screen
            )
            
            if game.is_finished():
                break
            
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        cap.release()
        cv2.destroyAllWindows()

def run_blink_monitor():

    # 카메라
    cap = cv2.VideoCapture(0, cv2.CAP_AVFOUNDATION)
    
    if not cap.isOpened():
        print("카메라를 열 수 없습니다.")
        return
    
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    print("cam width = ", width, "cam height = ", height)
    
    # MediaPipe Face Landmarker 설정
    BaseOptions = mp.tasks.BaseOptions
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=MODEL_PATH,
            delegate=BaseOptions.Delegate.CPU
        ),
        running_mode=VisionRunningMode.VIDEO,
        num_faces=1,
    )
    
    blink_monitor = BlinkMonitor()
    
    # Face Landmarker 생성
    with FaceLandmarker.create_from_options(options) as landmarker:

        print("Face Landmarker 시작")
        print("Q를 누르면 종료합니다.")

        frame_timestamp_ms = 0
        
        while True:
            ret, frame = cap.read()

            if not ret:
                print("카메라 프레임을 읽을 수 없습니다.")
                break

            # OpenCV는 BGR → MediaPipe는 RGB
            rgb_frame = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2RGB
            )

            # MediaPipe Image 생성
            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=rgb_frame
            )

            # 얼굴 landmark 추론
            result = landmarker.detect_for_video(
                mp_image,
                frame_timestamp_ms
            )

            frame_timestamp_ms += 33

            # landmark 그리기
            if result.face_landmarks:

                h, w, _ = frame.shape
                
                for face_landmarks in result.face_landmarks:    
                    
                    # 눈 깜빡임 체크
                    blink_result = blink_monitor.update(
                        face_landmarks
                    )
                    
                    if blink_result["is_blinking"]:
                        print("blink detected, current blink : " + blink_result["blink_count"])


                    
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        cap.release()

    
def main():
    
    args = parse_args()
    
    if args.calibrate:
        run_calibration()
        
    elif args.blink:
        run_blink_monitor()
    else:
        run_game_mode()

if __name__ == "__main__":
    main()