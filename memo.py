import cv2
import mediapipe as mp
import numpy as np
import random
import time

# MediaPipe Face Mesh 초기화
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,  # 468~477번 홍채(Iris) 랜드마크 활성화
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

def get_distance(p1, p2):
    return np.linalg.norm(np.array(p1) - np.array(p2))

def calculate_ear(landmarks, width, height):
    # 좌안 랜드마크: 33(외안각), 133(내안각), 160/144, 158/153(상하 눈꺼풀)
    idx = [33, 133, 160, 144, 158, 153]
    pts = [(int(landmarks[i].x * width), int(landmarks[i].y * height)) for i in idx]
    
    # EAR 계산: 수직거리 / (2 * 수평거리)
    v1 = get_distance(pts[2], pts[3])
    v2 = get_distance(pts[4], pts[5])
    h = get_distance(pts[0], pts[1])
    
    if h == 0:
        return 0.0
    return (v1 + v2) / (2.0 * h)

def get_gaze_ratio(landmarks, width, height):
    # 좌안 외/내안각 및 홍채 중심(468)
    p_left = np.array([landmarks[33].x * width, landmarks[33].y * height])
    p_right = np.array([landmarks[133].x * width, landmarks[133].y * height])
    p_iris = np.array([landmarks[468].x * width, landmarks[468].y * height])
    
    # 좌우 폭 대비 홍채 X 좌표 비율 (0.0: 왼쪽 끝, 1.0: 오른쪽 끝)
    eye_width = p_right[0] - p_left[0]
    if eye_width == 0:
        return 0.5
    ratio = (p_iris[0] - p_left[0]) / eye_width
    return np.clip(ratio, 0.0, 1.0)

# 웹캠 설정
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

# 게임 변수
score = 0
blink_count = 0
is_blinking = False
smoothed_gaze_x = 0.5
target_pos = [random.randint(150, 1130), 360]
target_radius = 45
hit_effect_time = 0

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    # 좌우 반전 (거울 모드)
    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb_frame)

    aim_x = int(w * 0.5)

    if results.multi_face_landmarks:
        mesh_points = results.multi_face_landmarks[0].landmark

        # 1. 눈 깜빡임 판별
        ear = calculate_ear(mesh_points, w, h)
        if ear < 0.19 and not is_blinking:
            is_blinking = True
            blink_count += 1
            # 조준 상태에서 깜빡였을 때 타겟 격추 체크
            if abs(aim_x - target_pos[0]) < target_radius:
                score += 1
                hit_effect_time = time.time()
                target_pos = [random.randint(150, w - 150), 360]
        elif ear > 0.23:
            is_blinking = False

        # 2. 시선 추적 (정규화 및 스무딩)
        raw_gaze = get_gaze_ratio(mesh_points, w, h)
        # 웹캠 왜곡 보정 (일반적인 동공 가동 범위 0.35~0.65를 0~1로 리스케일)
        remapped_gaze = (raw_gaze - 0.35) / (0.65 - 0.35)
        remapped_gaze = np.clip(remapped_gaze, 0.0, 1.0)
        
        # EMA 필터로 떨림(Jitter) 완화
        smoothed_gaze_x = smoothed_gaze_x * 0.75 + remapped_gaze * 0.25
        aim_x = int(smoothed_gaze_x * w)

    # UI 및 게임 렌더링
    # 과녁 그리기
    target_color = (0, 255, 0) if time.time() - hit_effect_time < 0.3 else (0, 0, 255)
    cv2.circle(frame, (target_pos[0], target_pos[1]), target_radius, target_color, -1)
    cv2.circle(frame, (target_pos[0], target_pos[1]), target_radius - 15, (255, 255, 255), 3)

    # 시선 조준선(Aim) 그리기
    is_locked = abs(aim_x - target_pos[0]) < target_radius
    line_color = (0, 255, 255) if is_locked else (255, 100, 0)
    cv2.line(frame, (aim_x, 0), (aim_x, h), line_color, 2)
    cv2.circle(frame, (aim_x, 360), 12, line_color, -1)

    # HUD 정보 텍스트
    cv2.putText(frame, f"Score: {score}", (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
    cv2.putText(frame, f"Blinks: {blink_count}", (30, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    
    status_text = "LOCKED! BLINK TO SHOOT!" if is_locked else "Look at the target..."
    cv2.putText(frame, status_text, (30, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.8, line_color, 2)

    cv2.imshow("Gaze Game & Blink Detection (Press 'q' to exit)", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()