(() => {
  function canvasPoint(point, config) {
    const {xmin,xmax,ymin,ymax,border,width,height}=config;
    const pixperx=(width-2*border)/(xmax-xmin),pixpery=(height-2*border)/(ymax-ymin);
    return [Math.round((point.x-xmin)*pixperx+border),Math.round(height-(point.y-ymin)*pixpery-border)];
  }
  function serializeTwoPointDrawing(mode,points,config) {
    const pixels=points.flatMap(point=>canvasPoint(point,config));
    return {pixels,value:`;;;;;;(${Number(mode)},${pixels.join(',')});;`};
  }
  function parseTwoPointDrawing(value) {
    const section=String(value||'').split(';;')[3]||'',curves=[];
    const re=/\((5(?:\.\d)?|6(?:\.\d)?|7(?:\.\d)?|8(?:\.\d)?|9(?:\.\d)?),([^)]*)\)/g;let match;
    while((match=re.exec(section))){const pixels=match[2].split(',').map(Number);if(pixels.every(Number.isFinite))curves.push({mode:Number(match[1]),pixels});}
    return curves;
  }
  function verifyTwoPointDrawing(value,mode,pixels){
    const curve=parseTwoPointDrawing(value).find(item=>Math.abs(item.mode-Number(mode))<1e-9);
    return !!curve&&curve.pixels.length===pixels.length&&curve.pixels.every((v,i)=>v===pixels[i]);
  }
  self.MOMInputAdapter={canvasPoint,serializeTwoPointDrawing,parseTwoPointDrawing,verifyTwoPointDrawing};
})();
