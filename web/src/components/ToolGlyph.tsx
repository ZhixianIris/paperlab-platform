import {
  CompressIcon,
  ConvertIcon,
  CropIcon,
  FileIcon,
  ImageIcon,
  ResizeIcon,
  RotateIcon,
  ScissorsIcon,
  SparklesIcon,
} from './Icons';
import type { ToolMeta } from '../lib/tools';

export function ToolGlyph({ icon, size = 22 }: { icon: ToolMeta['icon']; size?: number }) {
  switch (icon) {
    case 'file':
      return <FileIcon size={size} />;
    case 'scissors':
      return <ScissorsIcon size={size} />;
    case 'rotate':
      return <RotateIcon size={size} />;
    case 'crop':
      return <CropIcon size={size} />;
    case 'resize':
      return <ResizeIcon size={size} />;
    case 'convert':
      return <ConvertIcon size={size} />;
    case 'compress':
      return <CompressIcon size={size} />;
    case 'sparkles':
      return <SparklesIcon size={size} />;
    default:
      return <ImageIcon size={size} />;
  }
}
