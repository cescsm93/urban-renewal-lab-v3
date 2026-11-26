function createResultView(map) {
  const source='copilot-answer-points';
  let popup;
  let featuredMarker;
  let current;
  function clear() {
    current=null;
    popup?.remove();
    featuredMarker?.remove();
    featuredMarker=null;
    map.getSource(source)?.setData({type:'FeatureCollection',features:[]});
  }
  function open(place) {
    popup?.remove();
    const label=place.value!=null ? Math.round(place.value).toLocaleString()+' 元/㎡' : '距项目中心约 '+Math.round(place.meters)+' 米';
    const lines=place.lines?.length ? ' · '+place.lines.join('、') : '';
    popup=new maplibregl.Popup({closeOnClick:false}).setLngLat(place.point).setText(place.name+lines+' · '+label).addTo(map);
  }
  map.addSource(source,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:source,type:'circle',source,paint:{
    'circle-radius':['case',['get','featured'],10,6],'circle-color':['case',['get','featured'],'#f59419','#027a9d'],
    'circle-stroke-color':'white','circle-stroke-width':2
  }});
  map.on('click',source,e=>{const place=current?.places[e.features[0].properties.index];if(place)open(place)});
  function show(center,places,featured) {
    clear();
    if(!places.length)return;
    current={center,places,featured};
    map.getSource(source).setData({type:'FeatureCollection',features:places.map((p,index)=>({
      type:'Feature',geometry:{type:'Point',coordinates:p.point},properties:{index,name:p.name,featured:p===featured}
    }))});
    map.moveLayer(source);
    if(featured?.lines?.length){
      const badge=document.createElement('button');
      badge.type='button';
      badge.textContent='地铁 '+featured.lines.join('、')+' · '+featured.name;
      badge.title='点击查看车站位置和距离';
      badge.setAttribute('aria-label',badge.textContent);
      badge.style.cssText='padding:7px 11px;border:2px solid #f59419;border-radius:9px;background:#fff;color:#173d49;font:600 13px system-ui;box-shadow:0 3px 12px #173d4960;white-space:nowrap;cursor:pointer;max-width:260px;overflow:hidden;text-overflow:ellipsis';
      badge.onclick=event=>{event.stopPropagation();open(featured)};
      featuredMarker=new maplibregl.Marker({element:badge,anchor:'bottom',offset:[0,-14]}).setLngLat(featured.point).addTo(map);
    }
  }
  function focus() {
    if(!current)return;
    const {center,places,featured}=current;
    const bounds=new maplibregl.LngLatBounds(center,center);
    for(const p of places)bounds.extend(p.point);
    map.resize().fitBounds(bounds,{padding:Math.min(75,map.getCanvas().clientWidth/6),maxZoom:17,duration:350});
    if(featured&&!featured.lines?.length)open(featured);
  }
  return {clear,show,focus};
}
