/* Each pixel is a 5 m cell in a local tangent approximation. */
function computeGrid({centers,bounds,cellSize=5,radius=250},progress=()=>{}){
 if(cellSize!==5||![100,250,500].includes(radius))throw Error('不支持的栅格参数');
 const [west,south,east,north]=bounds;
 if(!bounds.every(Number.isFinite)||west>=east||south>=north||west< -180||east>180||south< -70||north>70)throw Error('请使用纬度 ±70° 以内且不跨日期变更线的局部范围。');
 const midLat=(north+south)/2,kx=6378137*Math.PI/180*Math.cos(midLat*Math.PI/180),ky=6378137*Math.PI/180;
 const width=Math.ceil((east-west)*kx/cellSize),height=Math.ceil((north-south)*ky/cellSize);
 if(width*height>1000000)throw Error('当前范围超过 100 万个 5 米栅格（约 25 km²），请放大地图或缩小资源范围；不会自动降低分辨率。');
 const cells=width*height,grid=new Uint32Array(cells),bins=new Map();let operations=0;
 const binKey=(x,y)=>x+','+y;
 centers.forEach(([lon,lat])=>{const x=(lon-west)*kx,y=(north-lat)*ky;const key=binKey(Math.floor(x/radius),Math.floor(y/radius));if(!bins.has(key))bins.set(key,[]);bins.get(key).push([x,y])});
 let max=0;for(let row=0;row<height;row++){const y=(row+.5)*cellSize,by=Math.floor(y/radius);for(let col=0;col<width;col++){const x=(col+.5)*cellSize,bx=Math.floor(x/radius);let n=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const ps=bins.get(binKey(bx+i,by+j));if(ps)for(const p of ps){if(++operations>50000000)throw Error('计算量较大，请缩小范围或分类后再生成。');if((x-p[0])**2+(y-p[1])**2<=radius*radius)n++}}grid[row*width+col]=n;if(n>max)max=n}if(row%100===0)progress(Math.round(row/height*90))}
 const stops=[[55,126,184],[143,211,173],[254,224,139],[253,174,97],[215,48,39]],pixels=new Uint8ClampedArray(cells*4);
 for(let i=0;i<cells;i++){const count=grid[i];if(!count)continue;const t=max===1?4:((count-1)/(max-1))*4,a=Math.min(3,Math.floor(t)),f=t-a;for(let k=0;k<3;k++)pixels[i*4+k]=Math.round(stops[a][k]*(1-f)+stops[a+1][k]*f);pixels[i*4+3]=225}
 return{width,height,cellSize,radius,max,pixels:pixels.buffer,corners:[[west,north],[west+width*cellSize/kx,north],[west+width*cellSize/kx,north-height*cellSize/ky],[west,north-height*cellSize/ky]],bounds,midLat};
}
if(typeof self!=='undefined')self.onmessage=e=>{try{const data=computeGrid(e.data,p=>self.postMessage({progress:p}));self.postMessage(data,[data.pixels])}catch(e){self.postMessage({error:e.message})}};
if(typeof module!=='undefined')module.exports={computeGrid};
