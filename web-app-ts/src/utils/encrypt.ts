
const MYBASE16_CHARSET = '0123456789, ';
const BASE64_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base16to64(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    let number = 0;
    const target = input.substring(i, i + 3) + '  '.substring(0, 3 - (input.length - i));

    number += MYBASE16_CHARSET.indexOf(target[0]) * 16 * 16;
    number += MYBASE16_CHARSET.indexOf(target[1]) * 16;
    number += MYBASE16_CHARSET.indexOf(target[2]);

    output += BASE64_CHARSET[(number >> 6) & 0x3f];
    output += BASE64_CHARSET[number & 0x3f];
  }
  
  return output;
}

function base64to16(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 2) {
    let number = 0;
    const target = input.substring(i, i + 2) + 'A'.substring(0, 2 - (input.length - i));

    number += BASE64_CHARSET.indexOf(target[0]) * 64;
    number += BASE64_CHARSET.indexOf(target[1]);

    output += MYBASE16_CHARSET[(number >> 8) & 0xff];
    output += MYBASE16_CHARSET[(number >> 4) & 0xf];
    output += MYBASE16_CHARSET[number & 0xf];
  }

  return output;
}

//#endregion
export function encrypt(plaintext : string, key: string): string {
  const keyBase64 = base16to64(plaintext);
  let output = '';
  let previousIndex = 0;
  for (let i = 0; i < keyBase64.length; i++) {
    const keyChar = key[i % key.length];
    const keyIndex = BASE64_CHARSET.indexOf(keyChar);
    const characterIndex = BASE64_CHARSET.indexOf(keyBase64[i]);
    output += BASE64_CHARSET[(characterIndex + keyIndex + previousIndex) % 64];
    previousIndex = characterIndex;
  }

  return output;
}

export function decrypt(ciphertext: string, key: string): string {
  let output = '';
  let previousIndex = 0;
  for (let i = 0; i < ciphertext.length; i++) {
    const keyChar = key[i % key.length];
    const keyIndex = BASE64_CHARSET.indexOf(keyChar);
    const characterIndex = (BASE64_CHARSET.indexOf(ciphertext[i]) - keyIndex - previousIndex + 64 * 2) % 64;
    output += BASE64_CHARSET[characterIndex];
    previousIndex = characterIndex;
  }

  return base64to16(output);
}

export function generateKey(length: number): string {
  let key = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * BASE64_CHARSET.length);
    key += BASE64_CHARSET[randomIndex];
  }
  return key;
}
