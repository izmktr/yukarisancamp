from __future__ import annotations

import re

alphamatch = re.compile('^[a-z]+')


def Command(inputline, cmd):
    if isinstance(cmd, list):
        for c in cmd:
            ret = Command(inputline, c)
            if ret is not None:
                return ret
        return None

    if len(cmd) == 0:
        print('null command.')
        return None

    if alphamatch.match(cmd):
        result = alphamatch.match(inputline)
        if result is None:
            return None

        if result.group(0) == cmd:
            return inputline[len(cmd):].strip()
    else:
        length = len(cmd)
        if inputline[:length] == cmd:
            return inputline[length:].strip()

    return None
