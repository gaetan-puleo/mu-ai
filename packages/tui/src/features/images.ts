import { type Capabilities, capability } from '../capabilities';
import type { TuiFeature } from '../feature';
import { APC, OSC, ST } from '../protocol';

export interface ImageRequest {
  source: { kind: 'base64'; data: string } | { kind: 'sixel'; data: string } | { kind: 'text'; alt: string };
  widthCells?: number;
  heightCells?: number;
  alt?: string;
}

export interface ImageBackend {
  readonly name: 'kitty' | 'sixel' | 'iterm2' | 'unicode';
  supported: (caps: Capabilities) => boolean;
  render: (request: ImageRequest, caps: Capabilities) => string[];
  cleanup?: () => string;
}

export function imageFeature(options: { allow: boolean } = { allow: false }): TuiFeature {
  return {
    name: 'images',
    detect() {
      return {
        graphics: { unicode: capability(true, 'feature') },
        security: { images: options.allow ? 'allow' : 'deny' },
      };
    },
  };
}

export function selectImageBackend(
  caps: Capabilities,
  preferred: ImageBackend['name'][] = ['kitty', 'sixel', 'iterm2', 'unicode'],
  backends: ImageBackend[] = [kittyImageBackend, sixelImageBackend, iterm2ImageBackend, unicodeImageBackend],
): ImageBackend {
  for (const name of preferred) {
    const backend = backends.find((candidate) => candidate.name === name);
    if (backend?.supported(caps)) return backend;
  }
  return unicodeImageBackend;
}

const kittyImageBackend: ImageBackend = {
  name: 'kitty',
  supported: (caps) => caps.security.images === 'allow' && caps.graphics.kitty.value,
  render(request) {
    if (request.source.kind !== 'base64') return unicodeImageBackend.render(request, {} as Capabilities);
    const width = request.widthCells ? `,c=${request.widthCells}` : '';
    const height = request.heightCells ? `,r=${request.heightCells}` : '';
    return [`${APC}Gf=100,a=T${width}${height};${request.source.data}${ST}`];
  },
};

const sixelImageBackend: ImageBackend = {
  name: 'sixel',
  supported: (caps) => caps.security.images === 'allow' && caps.graphics.sixel.value,
  render(request) {
    if (request.source.kind !== 'sixel') return unicodeImageBackend.render(request, {} as Capabilities);
    return [request.source.data];
  },
};

const iterm2ImageBackend: ImageBackend = {
  name: 'iterm2',
  supported: (caps) => caps.security.images === 'allow' && caps.graphics.iterm2.value,
  render(request) {
    if (request.source.kind !== 'base64') return unicodeImageBackend.render(request, {} as Capabilities);
    const width = request.widthCells ? `;width=${request.widthCells}` : '';
    const height = request.heightCells ? `;height=${request.heightCells}` : '';
    return [`${OSC}1337;File=inline=1${width}${height}:${request.source.data}${ST}`];
  },
};

export const unicodeImageBackend: ImageBackend = {
  name: 'unicode',
  supported: () => true,
  render(request) {
    const label = request.alt ?? (request.source.kind === 'text' ? request.source.alt : 'image');
    return [`[${label}]`];
  },
};
