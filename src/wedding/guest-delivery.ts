import type {MediaKind} from './media-copy';
export type MediaInputSource='gallery'|'camera'|'recorder'|'file'|'unknown';
export type CaptureFailure='unsupported'|'denied'|'missing'|'inUse'|'failed'|'empty';
export const captureFailureCodes:Record<CaptureFailure,string>={unsupported:'CAPTURE_UNSUPPORTED',denied:'CAPTURE_PERMISSION_DENIED',missing:'CAPTURE_DEVICE_MISSING',inUse:'CAPTURE_DEVICE_BUSY',failed:'CAPTURE_FAILED',empty:'CAPTURE_EMPTY'};
export function baseMime(value:string){const mime=value.split(';')[0].trim().toLowerCase();return /^[a-z\d.+-]+\/[a-z\d.+-]+$/.test(mime)&&mime.length<=100?mime:undefined;}

const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type UploadReceipt={mediaId:string;kind:MediaKind;state:'uploaded'|'attached';submissionId:string|null;expiresAt:string|null};
export type SubmissionReceipt={accepted:true;state:'committed';submissionId:string;mediaId:string|null;replayed:boolean};
export function uploadReceipt(value:unknown,expectedKind?:MediaKind):UploadReceipt{
  const item=value as Partial<UploadReceipt>|null;
  if(!item||typeof item.mediaId!=='string'||!uuid.test(item.mediaId)||!['photo','audio','video'].includes(item.kind||'')||expectedKind&&item.kind!==expectedKind||!['uploaded','attached'].includes(item.state||''))throw new Error('UNCONFIRMED_UPLOAD');
  return item as UploadReceipt;
}
export function submissionReceipt(value:unknown,expectedMediaId:string|null):SubmissionReceipt{
  const item=value as Partial<SubmissionReceipt>|null;
  if(!item||item.accepted!==true||item.state!=='committed'||typeof item.submissionId!=='string'||!uuid.test(item.submissionId)||item.mediaId!==expectedMediaId||typeof item.replayed!=='boolean')throw new Error('UNCONFIRMED_SUBMISSION');
  return item as SubmissionReceipt;
}
export const deliveryCopy={
  hu:{stored:'Az eredeti fájl megmaradt a szerveren. A könyv tulajdonosa újrapróbálhatja a feldolgozást; utána itt ellenőrizheted és véglegesítheted ugyanazt a beküldést.',receipt:'Beküldés azonosítója',diagnostic:'Hibaazonosító',unconfirmed:'A beküldés még nincs visszaigazolva. A megadott adatok és a kiválasztott fájl itt megmaradtak.',processing:'A korábbi feltöltés feldolgozása még folyamatban van. Ellenőrizd újra később; még nem történt végleges beküldés.',failed:'A feltöltés feldolgozása nem sikerült. A korábbi próbálkozást ugyanazzal a fájllal újrapróbálhatod.'},
  en:{stored:'The original file remains on the server. The book owner can retry processing; afterwards check and finalize the same submission here.',receipt:'Submission receipt',diagnostic:'Error reference',unconfirmed:'Delivery is not confirmed yet. The entered details and selected file remain here.',processing:'The earlier upload is still being processed. Check again later; it has not been submitted yet.',failed:'The upload could not be processed. Retry the same attempt with the same file.'},
  de:{stored:'Die Originaldatei bleibt auf dem Server. Der Buchbesitzer kann die Verarbeitung wiederholen; danach denselben Eintrag hier prüfen und abschließen.',receipt:'Eintragsbestätigung',diagnostic:'Fehlerkennung',unconfirmed:'Der Empfang ist noch nicht bestätigt. Angaben und ausgewählte Datei bleiben hier erhalten.',processing:'Der frühere Upload wird noch verarbeitet. Später erneut prüfen; der Eintrag wurde noch nicht eingereicht.',failed:'Der Upload konnte nicht verarbeitet werden. Denselben Versuch mit derselben Datei wiederholen.'},
};
