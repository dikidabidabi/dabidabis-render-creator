import type { Clading, CladingBox } from "./clading";
import type { Detail3dPrism } from "./level-detail-3d";
import { boxOutline, clipOutline, ringArea, solidFaces, type CladingPoint } from "./clading-solid";

/** All dimensions below are meters; shell and hollow bars share the union faces. */
export function polygonCladingPrisms(items: Clading[], ppm: number, elevation: number): Detail3dPrism[] {
  const prisms: Detail3dPrism[]=[];
  const emit=(outer:CladingPoint[],bottom:number,top:number,kind:"clading"|"cladingFrame")=>{
    if(top-bottom<1e-7 || Math.abs(ringArea(outer))<1e-10) return;
    prisms.push({kind,outer,holes:[],bottom:bottom-elevation,top:top-elevation});
  };
  const rectangle=(x:number,y:number,X:number,Y:number):CladingPoint[]=>[{x,y},{x:X,y},{x:X,y:Y},{x,y:Y}];
  for(const item of items){
    const boxes:CladingBox[]=item.boxes.map(b=>({min:{x:b.min.x/ppm,y:b.min.y/ppm,z:b.min.z},max:{x:b.max.x/ppm,y:b.max.y/ppm,z:b.max.z},points:boxOutline(b).map(p=>({x:p.x/ppm,y:p.y/ppm}))}));
    for(const face of solidFaces(boxes)){
      if(face.edge && face.normal){
        const {a,b}=face.edge,n=face.normal, length=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
        const band=(t:number,T:number,inset:number,width:number)=>[{x:a.x+ux*t-n.x*inset,y:a.y+uy*t-n.y*inset},{x:a.x+ux*T-n.x*inset,y:a.y+uy*T-n.y*inset},{x:a.x+ux*T-n.x*(inset+width),y:a.y+uy*T-n.y*(inset+width)},{x:a.x+ux*t-n.x*(inset+width),y:a.y+uy*t-n.y*(inset+width)}];
        const bottom=face.box.min.z,top=face.box.max.z;
        emit(band(0,length,0,0.02),bottom,top,"clading");
        const ticks=[0.02,length-0.02];for(let t=0.5;t<length-0.04;t+=0.5) ticks.push(t);
        for(const t of ticks){ const lo=Math.max(0,t-0.02),hi=Math.min(length,t+0.02);
          emit(band(lo,hi,0.02,0.002),bottom,top,"cladingFrame");emit(band(lo,hi,0.058,0.002),bottom,top,"cladingFrame");
          emit(band(lo,Math.min(hi,lo+0.002),0.022,0.036),bottom,top,"cladingFrame");emit(band(Math.max(lo,hi-0.002),hi,0.022,0.036),bottom,top,"cladingFrame");
        }
        const zs=[bottom+0.02,top-0.02];for(let z=Math.ceil((bottom+0.04)/0.5)*0.5;z<top-0.04;z+=0.5) zs.push(z);
        for(const z of zs){ const lo=Math.max(bottom,z-0.02),hi=Math.min(top,z+0.02);
          emit(band(0,length,0.02,0.002),lo,hi,"cladingFrame");emit(band(0,length,0.058,0.002),lo,hi,"cladingFrame");
          emit(band(0,length,0.022,0.036),lo,Math.min(hi,lo+0.002),"cladingFrame");emit(band(0,length,0.022,0.036),Math.max(lo,hi-0.002),hi,"cladingFrame");
        }
      }else{
        const polygon=face.polygon??boxOutline(face.box),surface=face.sign>0?face.box.max.z:face.box.min.z;
        emit(polygon,face.sign>0?surface-0.02:surface,face.sign>0?surface:surface+0.02,"clading");
        const low=face.sign>0?surface-0.06:surface+0.02,high=low+0.04;
        const clipped=(shape:CladingPoint[],z:number,Z:number)=>{for(const ring of clipOutline(polygon,shape)) emit(ring,z,Z,"cladingFrame");};
        for(const axis of ["x","y"] as const){
          const min=face.box.min[axis],max=face.box.max[axis],ticks=[min+0.02,max-0.02];for(let t=Math.ceil((min+0.04)/0.5)*0.5;t<max-0.04;t+=0.5)ticks.push(t);
          for(const t of ticks){
            const lo=Math.max(min,t-0.02),hi=Math.min(max,t+0.02);
            const bar=(l:number,h:number)=>axis==="x"?rectangle(l,face.box.min.y,h,face.box.max.y):rectangle(face.box.min.x,l,face.box.max.x,h);
            clipped(bar(lo,hi),low,low+0.002);clipped(bar(lo,hi),high-0.002,high);clipped(bar(lo,Math.min(hi,lo+0.002)),low+0.002,high-0.002);clipped(bar(Math.max(lo,hi-0.002),hi),low+0.002,high-0.002);
          }
        }
        // Rails follow every polygon edge, including sloping edges.
        polygon.forEach((a,i)=>{const b=polygon[(i+1)%polygon.length];if(!b)return;const length=Math.hypot(b.x-a.x,b.y-a.y),sign=ringArea(polygon)>0?1:-1,n={x:-(b.y-a.y)/length*sign,y:(b.x-a.x)/length*sign};
          const band=(inset:number,width:number)=>[a,b,{x:b.x+n.x*(inset+width),y:b.y+n.y*(inset+width)},{x:a.x+n.x*(inset+width),y:a.y+n.y*(inset+width)}].map((p,j)=>j<2?{x:p.x+n.x*inset,y:p.y+n.y*inset}:p);
          clipped(band(0,0.04),low,low+0.002);clipped(band(0,0.04),high-0.002,high);clipped(band(0,0.002),low+0.002,high-0.002);clipped(band(0.038,0.002),low+0.002,high-0.002);
        });
      }
    }
  }
  return prisms;
}