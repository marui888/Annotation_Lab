import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { VitePlugin } from '@electron-forge/plugin-vite'

export default {
  packagerConfig: {
    asar: false,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.js',
          config: 'vite.main.config.js',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.js',
          config: 'vite.preload.config.js',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.js',
        },
      ],
    }),
  ],
}