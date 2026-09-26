// Rehearsal baseline: cardinal moves on an unweighted rectangular grid.
export function findRoute(grid, start, goal) {
  const height=grid.length, width=grid[0]?.length ?? 0;
  const valid=([r,c])=>r>=0&&c>=0&&r<height&&c<width&&grid[r][c]!==1;
  if(!valid(start)||!valid(goal)) return null;
  const queue=[[start]], seen=new Set([start.join(',')]);
  for(let cursor=0;cursor<queue.length;cursor++) {
    const path=queue[cursor], [r,c]=path.at(-1);
    if(r===goal[0]&&c===goal[1]) return path;
    for(const [dr,dc] of [[0,1],[1,0],[0,-1],[-1,0]]) {
      const next=[r+dr,c+dc], key=next.join(',');
      if(valid(next)&&!seen.has(key)){seen.add(key);queue.push([...path,next]);}
    }
  }
  return null;
}
