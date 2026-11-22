// Minimal, harmless JPEG-based Motion Photo v1 (Android public format specification).
export function motionPhotoXmp(videoLength:number,padding=0){return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Camera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="${padding}"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${videoLength}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;}
export function withXmp(jpeg:Buffer,xml:string){
  const packet=Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'),Buffer.from(xml)]),header=Buffer.alloc(4);
  header[0]=255;header[1]=225;header.writeUInt16BE(packet.length+2,2);
  return Buffer.concat([jpeg.subarray(0,2),header,packet,jpeg.subarray(2)]);
}
export function motionPhoto(jpeg:Buffer,video:Buffer,xml=motionPhotoXmp(video.length),padding=0){return Buffer.concat([withXmp(jpeg,xml),Buffer.alloc(padding),video]);}
