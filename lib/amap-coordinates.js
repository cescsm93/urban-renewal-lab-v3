(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory();
  else root.RenewalCoordinates=factory();
})(globalThis,function(){
const R=6378245,EE=.00669342162296594323,PI=Math.PI;
const outside=(x,y)=>x<72.004||x>137.8347||y<.8293||y>55.8271;
function delta(lon,lat){const x=lon-105,y=lat-35;let dy=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));dy+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;dy+=(20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3;dy+=(160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3;let dx=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));dx+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;dx+=(20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3;dx+=(150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3;const rad=lat/180*PI,magic=1-EE*Math.sin(rad)**2,sqrt=Math.sqrt(magic);return[dx*180/(R/sqrt*Math.cos(rad)*PI),dy*180/((R*(1-EE))/(magic*sqrt)*PI)]}
function wgsToGcj([x,y]){if(outside(x,y))return[x,y];const d=delta(x,y);return[x+d[0],y+d[1]]}
function gcjToWgs(p){if(outside(...p))return p;let a=[...p];for(let i=0;i<5;i++){const g=wgsToGcj(a);a=[a[0]-(g[0]-p[0]),a[1]-(g[1]-p[1])]}return a}
return {outside,wgsToGcj,gcjToWgs};
});
