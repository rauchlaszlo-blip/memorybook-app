import {SaxesParser} from 'saxes';
import type {SaxesTagNS} from 'saxes';
import {PhotoError} from './media-error';
import {decodeAv} from './av-decoder';

const xmpHeader=Buffer.from('http://ns.adobe.com/xap/1.0/\0');
const camera='http://ns.google.com/photos/1.0/camera/',container='http://ns.google.com/photos/1.0/container/',itemNamespace='http://ns.google.com/photos/1.0/container/item/',rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const invalid=():never=>{throw new PhotoError('PHOTO_INVALID');};

// Read marker lengths and entropy escaping, never search naively for an EOI byte
// pair (EXIF/XMP and compressed data may contain the same bytes).
function jpegEnvelope(bytes:Buffer){
  if(bytes[0]!==255||bytes[1]!==216)invalid();
  let offset=2,inScan=false,scans=0,markers=0;const packets:Buffer[]=[];
  while(offset<bytes.length){
    if(inScan){
      const markerStart=bytes.indexOf(255,offset);if(markerStart<0)invalid();
      offset=markerStart+1;while(bytes[offset]===255)offset++;
      const code=bytes[offset];
      if(code===0||(code>=208&&code<=215)){offset++;continue;}
      offset=markerStart;inScan=false;
    }
    if(++markers>8192)invalid();
    if(bytes[offset++]!==255)invalid();while(bytes[offset]===255)offset++;
    const code=bytes[offset++];if(code===217){if(!scans)invalid();return{end:offset,packets};}
    if(code===1)continue;
    if(code<192||code===216||(code>=208&&code<=215)||offset+2>bytes.length)invalid();
    const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)invalid();
    const payload=bytes.subarray(offset+2,offset+length);
    if(code===225&&payload.subarray(0,xmpHeader.length).equals(xmpHeader))packets.push(payload.subarray(xmpHeader.length));
    offset+=length;if(code===218){scans++;inScan=true;}
  }
  return invalid();
}

function motionDirectory(packet:Buffer){
  const parser=new SaxesParser({xmlns:true}),stack:SaxesTagNS[]=[];
  const properties=new Map<string,string>(),items:Record<string,string>[]=[];
  let directories=0,sequences=0,listItems=0,elements=0,propertyText='';
  const is=(tag:SaxesTagNS|undefined,uri:string,local:string)=>tag?.uri===uri&&tag.local===local;
  const property=(name:string,value:string)=>{if(properties.has(name))invalid();properties.set(name,value.trim());};
  parser.on('error',invalid);parser.on('doctype',invalid);
  parser.on('opentag',tag=>{
    if(++elements>512||stack.length>=32)invalid();
    const parent=stack.at(-1);stack.push(tag);
    for(const attr of Object.values(tag.attributes))if(attr.uri===camera&&['MotionPhoto','MotionPhotoVersion'].includes(attr.local)){
      if(!is(tag,rdf,'Description'))invalid();property(attr.local,attr.value);
    }
    if(tag.uri===camera&&['MotionPhoto','MotionPhotoVersion'].includes(tag.local)){if(!is(parent,rdf,'Description'))invalid();propertyText='';}
    if(is(tag,container,'Directory')){if(++directories!==1||!is(parent,rdf,'Description'))invalid();}
    if(stack.some(t=>is(t,container,'Directory'))){
      if(is(tag,rdf,'Seq')){if(!is(parent,container,'Directory')||++sequences!==1)invalid();}
      else if(is(tag,rdf,'li')){if(!is(parent,rdf,'Seq')||++listItems>2)invalid();}
      else if(is(tag,container,'Item')){
        if(!is(parent,rdf,'li')||items.length>=2||items.length!==listItems-1)invalid();
        const item:Record<string,string>={};
        for(const attr of Object.values(tag.attributes))if(attr.uri===itemNamespace){if(!['Mime','Semantic','Length','Padding'].includes(attr.local))invalid();item[attr.local]=attr.value;}
        items.push(item);
      }else if(!is(tag,container,'Directory'))invalid();
    }
  });
  parser.on('text',text=>{const tag=stack.at(-1);if(tag?.uri===camera&&['MotionPhoto','MotionPhotoVersion'].includes(tag.local))propertyText+=text;else if(stack.some(t=>is(t,container,'Directory'))&&text.trim())invalid();});
  parser.on('cdata',()=>invalid());
  parser.on('closetag',tag=>{if(tag.uri===camera&&['MotionPhoto','MotionPhotoVersion'].includes(tag.local))property(tag.local,propertyText);stack.pop();});
  try{parser.write(new TextDecoder('utf-8',{fatal:true}).decode(packet)).close();}catch(error){if(error instanceof PhotoError)throw error;invalid();}
  if(properties.get('MotionPhoto')!=='1'||properties.get('MotionPhotoVersion')!=='1'||directories!==1||sequences!==1||listItems!==2||items.length!==2)invalid();
  const [primary,motion]=items;
  if(primary.Mime!=='image/jpeg'||primary.Semantic!=='Primary'||(primary.Length!==undefined&&primary.Length!=='0')||!['video/mp4','video/quicktime'].includes(motion.Mime)||motion.Semantic!=='MotionPhoto'||motion.Padding!==undefined)invalid();
  const integer=(value:string|undefined,fallback?:number)=>{if(value===undefined&&fallback!==undefined)return fallback;if(!value||!/^\d{1,8}$/.test(value))invalid();return Number(value);};
  const padding=integer(primary.Padding,0),length=integer(motion.Length);
  if(padding>65536||length<=0)invalid();return{padding,length,mime:motion.Mime};
}

// Supported subset: one complete JPEG + declared zero padding + one complete
// AVC/HEVC MP4/MOV clip. Arbitrary trailers, legacy SEF/MicroVideo, extra images,
// gain maps and unsupported clips remain rejected. The complete original is
// retained by the upload route; only this JPEG prefix is rendered as a photo.
export async function photoEnvelope(bytes:Buffer):Promise<Buffer>{
  const parsed=jpegEnvelope(bytes);if(parsed.end===bytes.length)return bytes;
  if(parsed.packets.length!==1)invalid();
  const motion=motionDirectory(parsed.packets[0]),start=parsed.end+motion.padding;
  if(start+motion.length!==bytes.length||bytes.subarray(parsed.end,start).some(byte=>byte!==0))invalid();
  const clip=bytes.subarray(start);
  if(clip.toString('ascii',4,8)!=='ftyp')invalid();
  const decoded=await decodeAv(clip,'video', {maxBytes:24*1024*1024,maxDurationSeconds:20}, false);
  if(decoded.mime!==motion.mime)invalid();
  return bytes.subarray(0,parsed.end);
}
