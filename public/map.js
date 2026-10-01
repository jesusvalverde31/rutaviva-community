import { Map, NavigationControl, setWorkerUrl } from '/vendor/maplibre/maplibre-gl.mjs';

setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
let map; let ready=false; let drawing=false; let points=[]; let onPoints=()=>{}; let onSelect=()=>{}; let contributions=[]; let routePoints={origin:null,destination:null}; let routeSelectMode=null; let onRoutePoint=()=>{}; let plannedRoutes=[];
const fc = features => ({ type:'FeatureCollection', features });
const featureFor = item => ({ type:'Feature', geometry:item.geometry, properties:{ id:item.id,status:item.status,kind:item.kind,title:item.title,conditionType:item.conditionType||'other',lifecycle:item.lifecycle||'open',measurementStatus:item.measurementStatus||'unmeasured',marker:item.lifecycle==='resolved'?'R':item.measurementStatus==='measured'?'M':item.status==='published'?'P':'O' } });
function drawFeature(){ return points.length ? [{ type:'Feature', geometry:points.length===1?{type:'Point',coordinates:points[0]}:{type:'LineString',coordinates:points}, properties:{} }] : []; }
function refreshSource(name,data){ if(ready&&map.getSource(name)) map.getSource(name).setData(fc(data)); }
function refreshDraw(){ refreshSource('drawing',drawFeature()); onPoints([...points]); }
export function initCommunityMap({center,tileUrl,select,status,pointsChanged}){
  onSelect=select||onSelect; onPoints=pointsChanged||onPoints;
  map=new Map({container:'map',center:[center.longitude,center.latitude],zoom:12.4,style:{version:8,sources:{osm:{type:'raster',tiles:[tileUrl],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm'}]}});
  map.addControl(new NavigationControl({showCompass:false}),'top-right');
  map.on('load',()=>{ ready=true; map.addSource('contributions',{type:'geojson',data:fc(contributions.map(featureFor))}); map.addLayer({id:'community-lines',type:'line',source:'contributions',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['case',['==',['get','status'],'published'],'#16745a','#d8762c'],'line-width':6,'line-opacity':.9}}); map.addLayer({id:'community-points',type:'circle',source:'contributions',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':8,'circle-color':['case',['==',['get','status'],'published'],'#16745a','#d8762c'],'circle-stroke-color':'#fff','circle-stroke-width':3}}); map.addSource('planned-routes',{type:'geojson',data:fc([])}); map.addLayer({id:'planned-accessible',type:'line',source:'planned-routes',filter:['==',['get','profile'],'accessible'],paint:{'line-color':'#8b3fd1','line-width':7,'line-dasharray':[2,1]}}); map.addLayer({id:'planned-direct',type:'line',source:'planned-routes',filter:['==',['get','profile'],'direct'],paint:{'line-color':'#086c5c','line-width':6}}); map.addSource('route-points',{type:'geojson',data:fc([])}); map.addLayer({id:'route-points',type:'circle',source:'route-points',paint:{'circle-radius':9,'circle-color':['case',['==',['get','kind'],'origin'],'#086c5c','#db5b36'],'circle-stroke-color':'#fff','circle-stroke-width':3}}); map.addSource('drawing',{type:'geojson',data:fc(drawFeature())}); map.addLayer({id:'drawing-line',type:'line',source:'drawing',paint:{'line-color':'#2457d6','line-width':5,'line-dasharray':[2,1]}}); map.addLayer({id:'drawing-point',type:'circle',source:'drawing',paint:{'circle-radius':6,'circle-color':'#2457d6','circle-stroke-color':'#fff','circle-stroke-width':2}}); for(const layer of ['community-lines','community-points']) map.on('click',layer,event=>onSelect(event.features?.[0]?.properties?.id)); status?.('Mapa preparado.'); refreshDraw(); refreshRoutePoints(); });
  map.on('load',()=>{map.addLayer({id:'community-point-status',type:'symbol',source:'contributions',filter:['==',['geometry-type'],'Point'],layout:{'text-field':['get','marker'],'text-size':11},paint:{'text-color':'#fff'}});map.on('click','community-point-status',event=>onSelect(event.features?.[0]?.properties?.id));});
  map.on('click',event=>{ if(routeSelectMode){setRoutePoint(routeSelectMode,[Number(event.lngLat.lng.toFixed(6)),Number(event.lngLat.lat.toFixed(6))]);routeSelectMode=null;return;} if(drawing&&points.length<50){ points.push([Number(event.lngLat.lng.toFixed(6)),Number(event.lngLat.lat.toFixed(6))]); refreshDraw(); }});
  map.on('error',()=>status?.('No se pudo cargar parte del mapa. La lista sigue disponible.'));
}
export function setMapContributions(items){ contributions=items||[]; refreshSource('contributions',contributions.map(featureFor)); }
export function startDrawing(){ drawing=true; }
export function stopDrawing(){ drawing=false; }
export function addCenterPoint(){ if(map&&points.length<50){ const c=map.getCenter(); points.push([Number(c.lng.toFixed(6)),Number(c.lat.toFixed(6))]); refreshDraw(); }}
export function undoPoint(){ points.pop(); refreshDraw(); }
export function clearDrawing(){ points=[]; refreshDraw(); }
export function geometryFor(kind){ if(!points.length)return null; if(['barrier','closure','lighting'].includes(kind))return{type:'Point',coordinates:points.at(-1)}; return points.length<2?null:{type:'LineString',coordinates:[...points]}; }
export function focusContribution(item){ if(!map||!item?.geometry)return; const pts=item.geometry.type==='Point'?[item.geometry.coordinates]:item.geometry.coordinates; const lng=pts.reduce((s,p)=>s+p[0],0)/pts.length; const lat=pts.reduce((s,p)=>s+p[1],0)/pts.length; map.flyTo({center:[lng,lat],zoom:15,essential:false}); }
export function focusZone(bbox){if(!map||!Array.isArray(bbox)||bbox.length!==4||bbox.some(value=>!Number.isFinite(Number(value))))return;map.fitBounds([[Number(bbox[0]),Number(bbox[1])],[Number(bbox[2]),Number(bbox[3])]],{padding:36,essential:false});}
function refreshRoutePoints(){const features=Object.entries(routePoints).filter(([,value])=>value).map(([kind,coordinates])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{kind}}));refreshSource('route-points',features);}
function setRoutePoint(kind,coordinates){routePoints[kind]=coordinates;refreshRoutePoints();onRoutePoint(kind,{longitude:coordinates[0],latitude:coordinates[1]});}
export function configureRoutePlanner(callback){onRoutePoint=callback||onRoutePoint;}
export function selectRoutePoint(kind){routeSelectMode=kind;}
export function addRouteCenterPoint(kind){if(!map)return;const center=map.getCenter();setRoutePoint(kind,[Number(center.lng.toFixed(6)),Number(center.lat.toFixed(6))]);}
export function clearRoutePlan(){plannedRoutes=[];refreshSource('planned-routes',[]);}
export function clearRouteSelection(){routePoints={origin:null,destination:null};refreshRoutePoints();clearRoutePlan();}
export function setRoutePlanPoints(origin,destination){routePoints={origin:origin?[origin.longitude,origin.latitude]:null,destination:destination?[destination.longitude,destination.latitude]:null};refreshRoutePoints();refreshSource('planned-routes',[]);}
export function setPlannedRoutes(routes){plannedRoutes=['accessible','direct'].filter(profile=>routes?.[profile]).map(profile=>({type:'Feature',geometry:routes[profile].geometry,properties:{profile}}));refreshSource('planned-routes',plannedRoutes);}
