export async function invoke(name:string){if(name==='inline_active')return true;if(name==='inline_exit')return;throw new Error('Unexpected native call in fixture')}
export async function listen(){return()=>{}}
