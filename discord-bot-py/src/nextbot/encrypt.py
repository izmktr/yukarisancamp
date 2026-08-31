import secrets


MYBASE16_CHARSET = "0123456789, "
BASE64_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def _require_characters(value: str, charset: str, name: str) -> None:
    invalid_characters = set(value) - set(charset)
    if invalid_characters:
        raise ValueError(f"{name} contains unsupported characters")


def _base16_to_64(value: str) -> str:
    output: list[str] = []
    for index in range(0, len(value), 3):
        target = value[index:index + 3].ljust(3)
        number = (
            MYBASE16_CHARSET.index(target[0]) * 16 * 16
            + MYBASE16_CHARSET.index(target[1]) * 16
            + MYBASE16_CHARSET.index(target[2])
        )
        output.append(BASE64_CHARSET[(number >> 6) & 0x3F])
        output.append(BASE64_CHARSET[number & 0x3F])
    return "".join(output)


def _base64_to_16(value: str) -> str:
    output: list[str] = []
    for index in range(0, len(value), 2):
        target = value[index:index + 2].ljust(2, "A")
        number = BASE64_CHARSET.index(target[0]) * 64 + BASE64_CHARSET.index(target[1])
        decoded_indexes = (
            (number >> 8) & 0xFF,
            (number >> 4) & 0x0F,
            number & 0x0F,
        )
        if any(decoded_index >= len(MYBASE16_CHARSET) for decoded_index in decoded_indexes):
            raise ValueError("ciphertext was not encrypted with the supplied key")
        output.extend(MYBASE16_CHARSET[decoded_index] for decoded_index in decoded_indexes)
    return "".join(output)


def encrypt(plaintext: str, key: str) -> str:
    _require_characters(plaintext, MYBASE16_CHARSET, "plaintext")
    _require_characters(key, BASE64_CHARSET, "key")
    if plaintext and not key:
        raise ValueError("key must not be empty")

    random_prefix = generate_key(1)

    encoded = _base16_to_64(plaintext)
    output: list[str] = []
    previous_index = BASE64_CHARSET.index(random_prefix)
    output.append(random_prefix)
    for index, character in enumerate(encoded):
        character_index = BASE64_CHARSET.index(character)
        key_index = BASE64_CHARSET.index(key[index % len(key)])
        output.append(BASE64_CHARSET[(character_index + key_index + previous_index) % 64])
        previous_index = character_index
    return "".join(output)


def decrypt(ciphertext: str, key: str) -> str:
    _require_characters(ciphertext, BASE64_CHARSET, "ciphertext")
    _require_characters(key, BASE64_CHARSET, "key")
    if ciphertext and not key:
        raise ValueError("key must not be empty")

    decoded: list[str] = []
    previous_index = BASE64_CHARSET.index(ciphertext[0])
    ciphertext = ciphertext[1:]  # Remove the random prefix
    for index, character in enumerate(ciphertext):
        character_index = BASE64_CHARSET.index(character)
        key_index = BASE64_CHARSET.index(key[index % len(key)])
        decoded_index = (character_index - key_index - previous_index) % 64
        decoded.append(BASE64_CHARSET[decoded_index])
        previous_index = decoded_index
    return _base64_to_16("".join(decoded))


def generate_key(length: int) -> str:
    if length < 0:
        raise ValueError("length must not be negative")
    return "".join(secrets.choice(BASE64_CHARSET) for _ in range(length))