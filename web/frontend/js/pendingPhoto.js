// 홈/마이페이지 퀵메뉴에서 시스템 카메라로 바로 찍은 사진을 analysis.html로
// 넘겨주기 위한 임시 저장소. File 객체는 URL 파라미터나 sessionStorage(문자열만
// 저장 가능, 큰 사진은 base64로 변환 시 용량이 33%가량 불어나 용량 제한에 걸리기
// 쉬움)로는 페이지 이동 간에 넘길 수 없어, File을 그대로 구조화 클론할 수 있는
// IndexedDB를 사용한다.
const DB_NAME = "eyeGodPendingPhoto";
const STORE_NAME = "photos";
const KEY = "pending";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storePendingPhoto(file) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(file, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// 한 번 읽으면 곧바로 지운다 - analysis.html을 다시 열었을 때 예전 사진이
// 재사용되지 않도록.
export async function takePendingPhoto() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(KEY);
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => reject(getRequest.error);
      store.delete(KEY);
    });
  } finally {
    db.close();
  }
}
