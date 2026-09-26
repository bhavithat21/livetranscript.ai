import {findRoute} from './maze.js';
const grid=Array.from({length:8},()=>Array(8).fill(0));const board=document.querySelector('#board'),status=document.querySelector('#status');
function render(path=[]) {
  board.replaceChildren();const selected=new Set(path.map(p=>p.join(',')));
  for(let r=0;r<8;r++){const row=document.createElement('div');for(let c=0;c<8;c++){const b=document.createElement('button');b.textContent=grid[r][c]?'#':selected.has(`${r},${c}`)?'*':'.';b.setAttribute('aria-label',`Cell ${r} ${c}`);b.style.cssText='width:36px;height:36px';b.onclick=()=>{grid[r][c]=1-grid[r][c];render()};row.append(b)}board.append(row)}
}
document.querySelector('#solve').onclick=()=>{const path=findRoute(grid,[0,0],[7,7]);status.textContent=path?`${path.length-1} moves`:'No route';render(path??[])};render();
