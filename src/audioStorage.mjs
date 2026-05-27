export const MOVEMAP_AUDIO_BUCKET = "movemap-audio";
export const LEGACY_AUDIO_BUCKET = "choreo-audio";

export function audioPublicUrl(storagePath, { url = "", bucket = MOVEMAP_AUDIO_BUCKET } = {}) {
  if (!url || !storagePath) return "";
  return `${url}/storage/v1/object/public/${bucket}/${encodeURI(storagePath)}`;
}

export function audioSourceCandidates(audio, config = {}) {
  if (!audio) return [];
  const bucket = audio.bucket || MOVEMAP_AUDIO_BUCKET;
  const candidates = [
    audio.publicUrl,
    audioPublicUrl(audio.storagePath, { ...config, bucket }),
    audioPublicUrl(audio.storagePath, { ...config, bucket: LEGACY_AUDIO_BUCKET })
  ];
  return candidates.filter(Boolean).filter((url, index, urls) => urls.indexOf(url) === index);
}

export function nextAudioSourceCandidate(audio, config = {}, rejectedUrls = []) {
  const rejected = new Set(rejectedUrls.filter(Boolean));
  return audioSourceCandidates(audio, config).find((url) => !rejected.has(url)) || "";
}

export function audioUploadErrorMessage(errorText = "") {
  let parsed = null;
  try {
    parsed = JSON.parse(errorText);
  } catch {
    parsed = null;
  }
  const message = parsed?.message || parsed?.error || String(errorText || "");
  const statusCode = String(parsed?.statusCode || "");
  if (statusCode === "404" && /bucket not found/i.test(message)) {
    return "Supabase Storage bucket `movemap-audio`가 없습니다. bucket을 만든 뒤 다시 업로드하세요.";
  }
  return message || "음악 업로드에 실패했습니다.";
}
