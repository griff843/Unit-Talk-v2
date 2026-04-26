import type { ProductConfig } from '../../core/types.js';

export const unitTalkConfig: ProductConfig = {
  id: 'unit-talk',
  displayName: 'Unit Talk V2',
  surfaces: {
    command_center: {
      id: 'command_center',
      displayName: 'Command Center',
      baseUrls: {
        local: 'http://localhost:4300',
        staging: 'https://cc-staging.unittalk.com',
        production: 'https://cc.unittalk.com',
      },
    },
    smart_form: {
      id: 'smart_form',
      displayName: 'Smart Form',
      baseUrls: {
        local: 'http://localhost:4100',
        staging: 'https://form-staging.unittalk.com',
        production: 'https://form.unittalk.com',
      },
    },
    discord: {
      id: 'discord',
      displayName: 'Discord',
      baseUrls: {
        local: 'https://discord.com/app',
        staging: 'https://discord.com/app',
        production: 'https://discord.com/app',
      },
    },
  },
};
