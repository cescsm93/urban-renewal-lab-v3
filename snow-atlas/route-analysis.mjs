// Along-line DEM estimates. Window grows with display grid spacing to avoid false precision.
export function routeAnalysis(coordinates,height,grid=[50,50]){
 const points=[];let distance=0;
 for(let i=1;i<coordinates.length;i++){
  const a=coordinates[i-1],b=coordinates[i],length=Math.hypot((b[0]-a[0])*111320*Math.cos((a[1]+b[1])*Math.PI/360),(b[1]-a[1])*111320);
  const count=Math.max(1,Math.ceil(length/25));
  for(let k=0;k<count;k++){const lon=a[0]+(b[0]-a[0])*k/count,lat=a[1]+(b[1]-a[1])*k/count;points.push({lon,lat,d:distance+length*k/count,h:height(lon,lat)})}distance+=length;
 }
 if(!coordinates.length)return {points:[],max:null,length:0};
 const last=coordinates.at(-1);points.push({lon:last[0],lat:last[1],d:distance,h:height(...last)});
 const window=Math.max(100,Math.ceil(2*Math.max(...grid)/25)*25);let peak=null,j=0;
 for(let i=0;i<points.length;i++){
  j=Math.max(j,i+1);while(j<points.length&&points[j].d-points[i].d<window)j++;
  if(j>=points.length)break;
  const a=points[i],b=points[j],run=b.d-a.d,grade=Math.abs(b.h-a.h)/run,angle=Math.atan(grade)*180/Math.PI;
  if(Number.isFinite(angle)&&(!peak||angle>peak.angle))peak={angle,percent:grade*100,start:i,end:j,window:run};
 }
 return {points,max:peak,length:distance,window};
}
