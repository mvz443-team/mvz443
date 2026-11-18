// 网络诊断字节编码 Worker。
// 主线程只负责复制并转移原始字节；base64/hex 这类纯 CPU 编码在独立线程完成，
// 避免每个 WebSocket 包都在主线程做字符串拼接。

type EncodeRequest = {
  id: number;
  bytes: ArrayBuffer;
  limit: number;
};

type EncodeResponse = {
  id: number;
  hex: string;
  base64: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array, limit: number): string {
  const length = Math.min(bytes.length, limit);
  const parts: string[] = [];
  for (let index = 0; index < length; index += 1) {
    parts.push(bytes[index].toString(16).padStart(2, '0'));
  }
  return parts.join('');
}

self.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const { id, bytes: buffer, limit } = event.data;
  const bytes = new Uint8Array(buffer);
  const slice = bytes.subarray(0, Math.min(bytes.length, limit));
  const response: EncodeResponse = {
    id,
    hex: bytesToHex(bytes, limit),
    base64: bytesToBase64(slice),
  };
  self.postMessage(response);
};
