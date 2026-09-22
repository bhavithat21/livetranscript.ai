import { iconSource, type AppIcon } from './icons'

export function AppIconImage({ icon, size = 28 }: { icon: AppIcon; size?: number }) {
  // Local data URLs and the bundled favicon need no image-optimization request.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={iconSource(icon)} alt="" width={size} height={size} className="shrink-0 rounded-lg object-contain" draggable={false} />
}
