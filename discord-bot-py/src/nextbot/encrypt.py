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

    encoded = _base16_to_64(plaintext)
    return "".join(
        BASE64_CHARSET[
            (BASE64_CHARSET.index(character) + BASE64_CHARSET.index(key[index % len(key)])) % 64
        ]
        for index, character in enumerate(encoded)
    )


def decrypt(ciphertext: str, key: str) -> str:
    _require_characters(ciphertext, BASE64_CHARSET, "ciphertext")
    _require_characters(key, BASE64_CHARSET, "key")
    if ciphertext and not key:
        raise ValueError("key must not be empty")

    decoded = "".join(
        BASE64_CHARSET[
            (BASE64_CHARSET.index(character) - BASE64_CHARSET.index(key[index % len(key)]) + 64) % 64
        ]
        for index, character in enumerate(ciphertext)
    )
    return _base64_to_16(decoded)


def generate_key(length: int) -> str:
    if length < 0:
        raise ValueError("length must not be negative")
    return "".join(secrets.choice(BASE64_CHARSET) for _ in range(length))