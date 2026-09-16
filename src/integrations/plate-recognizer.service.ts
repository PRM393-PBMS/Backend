import { Injectable } from '@nestjs/common';
import { isValidLicensePlate, normalizeLicensePlate } from '../common/license-plate';

type PlateResult = {
  imageUrl?: string | null;
  licensePlate?: string | null;
  confidence?: number | null;
  regionCode?: string | null;
  provider: string;
  providerStatusCode?: number | null;
  providerError?: string | null;
  providerResponse?: string | null;
  minimumConfidence?: number | null;
  message?: string | null;
  candidates: Array<{ licensePlate: string; confidence: number; regionCode?: string | null }>;
};

@Injectable()
export class PlateRecognizerService {
  async recognize(file: import('../common/uploaded-image').UploadedImage, imageUrl?: string | null): Promise<PlateResult> {
    const apiKey = process.env.PLATE_RECOGNIZER_API_KEY?.trim() ?? '';
    const endpoint =
      process.env.PLATE_RECOGNIZER_ENDPOINT?.trim() || 'https://api.platerecognizer.com/v1/plate-reader/';
    const regions = (process.env.PLATE_RECOGNIZER_REGIONS ?? 'vn')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const minimumConfidence = Number(process.env.PLATE_RECOGNIZER_MINIMUM_CONFIDENCE ?? 0.75);

    if (!file?.buffer?.length) {
      return {
        provider: 'PlateRecognizer',
        message: 'File ảnh biển số không hợp lệ',
        candidates: [],
        imageUrl,
      };
    }
    if (!apiKey) {
      return {
        provider: 'PlateRecognizer',
        message: 'Chưa cấu hình Plate Recognizer API key',
        candidates: [],
        imageUrl,
        minimumConfidence,
      };
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'image/jpeg' });
    form.append('upload', blob, file.originalname || 'plate.jpg');
    for (const region of regions) {
      form.append('regions', region);
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}` },
      body: form,
    });
    const raw = await response.text();
    let parsed: {
      results?: Array<{
        plate?: string;
        score?: number;
        region?: { code?: string };
        candidates?: Array<{ plate?: string; score?: number }>;
      }>;
      error?: string;
    } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = {};
    }

    const candidates = (parsed.results ?? [])
      .flatMap((item) => {
        const list = item.candidates?.length
          ? item.candidates
          : [{ plate: item.plate, score: item.score }];
        return list.map((candidate) => ({
          licensePlate: normalizeLicensePlate(candidate.plate ?? ''),
          confidence: Number(candidate.score ?? item.score ?? 0),
          regionCode: item.region?.code ?? null,
        }));
      })
      .filter((item) => item.licensePlate && isValidLicensePlate(item.licensePlate))
      .sort((a, b) => b.confidence - a.confidence);

    const best = candidates.find((item) => item.confidence >= minimumConfidence) ?? candidates[0];

    return {
      imageUrl,
      licensePlate: best?.licensePlate ?? null,
      confidence: best?.confidence ?? null,
      regionCode: best?.regionCode ?? null,
      provider: 'PlateRecognizer',
      providerStatusCode: response.status,
      providerError: parsed.error ?? (!response.ok ? raw.slice(0, 500) : null),
      providerResponse: raw.slice(0, 4000),
      minimumConfidence,
      message: best ? null : 'Không nhận diện được biển số đạt ngưỡng tin cậy',
      candidates,
    };
  }
}
