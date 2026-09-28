// SMS encoding and segment count.
//
// A message goes as GSM 03.38 7-bit when every character is in the GSM
// alphabet, otherwise as UCS-2. Bangla is always UCS-2. Capacities:
//
//                 one part   each part of a longer message
//   GSM 7-bit       160        153   (extension characters take 2)
//   UCS-2            70         67   (characters outside the BMP take 2)
//
// Operators bill per part, so a 71-character Bangla reminder is two SMS.
// MiMSMS reports its own count (success_Data[].sms_Count); this estimate is
// for previews and limits before sending, and the provider's count replaces
// it once the send returns.

const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXTENSION = new Set('^{}\\[~]|€\f');

export interface SmsSegmentInfo {
  encoding: 'gsm7' | 'ucs2';
  /** What the network counts: septets for GSM, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
}

export function smsSegments(text: string): SmsSegmentInfo {
  let septets = 0;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENSION.has(ch)) septets += 2;
    else {
      const units = text.length; // UTF-16 code units: a surrogate pair counts twice
      return { encoding: 'ucs2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
    }
  }
  return { encoding: 'gsm7', units: septets, segments: septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153) };
}
