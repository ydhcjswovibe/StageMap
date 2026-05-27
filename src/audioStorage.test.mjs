import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  audioPublicUrl,
  audioSourceCandidates,
  audioUploadErrorMessage,
  nextAudioSourceCandidate,
  MOVEMAP_AUDIO_BUCKET
} from "./audioStorage.mjs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("builds new audio public URLs from the Movemap bucket", () => {
  assert.equal(MOVEMAP_AUDIO_BUCKET, "movemap-audio");
  assert.equal(
    audioPublicUrl("projects/demo/audio/song.mp3", { url: "https://example.supabase.co" }),
    "https://example.supabase.co/storage/v1/object/public/movemap-audio/projects/demo/audio/song.mp3"
  );
});

test("keeps legacy choreo storage paths playable as fallback candidates", () => {
  assert.deepEqual(
    audioSourceCandidates(
      { storagePath: "projects/demo/audio/song.mp3" },
      { url: "https://example.supabase.co" }
    ),
    [
      "https://example.supabase.co/storage/v1/object/public/movemap-audio/projects/demo/audio/song.mp3",
      "https://example.supabase.co/storage/v1/object/public/choreo-audio/projects/demo/audio/song.mp3"
    ]
  );
});

test("selects the next untried audio source and stops after all candidates fail", () => {
  const audio = {
    publicUrl: "https://cdn.example/audio.mp3",
    storagePath: "projects/demo/audio/song.mp3"
  };
  const config = { url: "https://example.supabase.co" };

  assert.equal(
    nextAudioSourceCandidate(audio, config, ["https://cdn.example/audio.mp3"]),
    "https://example.supabase.co/storage/v1/object/public/movemap-audio/projects/demo/audio/song.mp3"
  );
  assert.equal(
    nextAudioSourceCandidate(audio, config, [
      "https://cdn.example/audio.mp3",
      "https://example.supabase.co/storage/v1/object/public/movemap-audio/projects/demo/audio/song.mp3",
      "https://example.supabase.co/storage/v1/object/public/choreo-audio/projects/demo/audio/song.mp3"
    ]),
    ""
  );
});

test("explains missing Supabase audio bucket without exposing raw storage json", () => {
  assert.equal(
    audioUploadErrorMessage("{\"statusCode\":\"404\",\"error\":\"Bucket not found\",\"message\":\"Bucket not found\"}"),
    "Supabase Storage bucket `movemap-audio`가 없습니다. bucket을 만든 뒤 다시 업로드하세요."
  );
});

test("keeps local audio usable when server upload fails", () => {
  const handleAudioFile = appSource.match(/async function handleAudioFile\(event\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const uploadFailure = handleAudioFile.match(/\} catch \(error\) \{[\s\S]*?event\.target\.value = "";/)?.[0] || "";

  assert.match(appSource, /const hasUsableAudio = Boolean\(audioSrc\);/);
  assert.match(handleAudioFile, /localUrl = URL\.createObjectURL\(file\);/);
  assert.doesNotMatch(uploadFailure, /setAudioSrc\(""\);/);
  assert.doesNotMatch(uploadFailure, /URL\.revokeObjectURL\(localAudioUrlRef\.current\);/);
  assert.match(uploadFailure, /setStatusRecovery\(replacingAudio \? "audio" : ""\);/);
  assert.match(uploadFailure, /서버 저장은 실패했지만 이 브라우저에서는 음악을 들으며 편집할 수 있습니다/);
});
