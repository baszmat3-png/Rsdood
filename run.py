from fbchat import Client
from fbchat.models import *
from random import randrange
import os
import time
from datetime import datetime
import string
import pickle
from getpass import getpass

auto = '[Auto Reply by bot! 🤖 ]\n'

prev_threads = []    # people who already got the primary message
bloc_threads = []    # people who already got the secondary message (bot stays quiet for them)


def read_lines(path):
    """All lines of a file, kept 1:1 with line numbers (received.txt <-> reply.txt)."""
    with open(path, encoding='utf8') as f:
        return [line.rstrip('\n').strip() for line in f]


def read_text(path):
    """Whole file as text, without the '#' instruction lines."""
    with open(path, encoding='utf8') as f:
        return '\n'.join(l for l in f.read().splitlines() if not l.lstrip().startswith('#')).strip()


class Data:
    """Reloads the .txt files automatically whenever they are edited while the bot runs."""
    FILES = ('received.txt', 'reply.txt', 'blacklist.txt', 'msg1.txt', 'msg2.txt')

    def __init__(self):
        self.stamp = None
        self.reload()

    def reload(self):
        stamp = tuple(os.path.getmtime(f) for f in self.FILES)
        if stamp == self.stamp:
            return
        self.stamp = stamp
        self.received = read_lines('received.txt')
        self.reply = read_lines('reply.txt')
        self.blacklist = {l for l in read_lines('blacklist.txt') if l and not l.startswith('#')}
        self.txt1 = read_text('msg1.txt')
        self.txt2 = read_text('msg2.txt')
        if len(self.received) != len(self.reply):
            print('WARNING: received.txt has %d lines but reply.txt has %d. '
                  'Each received line must have its reply on the same line number.'
                  % (len(self.received), len(self.reply)))

    def find_reply(self, matching):
        """Reply for the first line of received.txt that appears inside the message."""
        for i, word in enumerate(self.received):
            if not word or word.startswith('#'):
                continue
            w = word.lower()
            # short latin words ("hi") must match a whole word, not part of "this"
            hit = (' %s ' % w) in (' %s ' % matching) if w.isascii() and w.replace(' ', '').isalnum() else w in matching
            if hit and i < len(self.reply) and self.reply[i]:
                return self.reply[i]
        return None


data = Data()


def normalize(text):
    if not text:
        return None
    t = text.lower().translate(str.maketrans('', '', string.punctuation)).strip()
    return t or None


class CustomClient(Client):
    def onMessage(self, author_id, message_object, thread_id, thread_type, ts, metadata, msg, **kwargs):
        # ignore my own messages, group chats and non-text messages
        if author_id == self.uid or thread_type != ThreadType.USER:
            return
        matching = normalize(message_object.text)
        if matching is None:
            return

        data.reload()
        if thread_id in data.blacklist:
            return

        time.sleep(randrange(4, 10))  # look human
        stamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # 1) a known word -> its specific reply
        answer = data.find_reply(matching)
        if answer:
            self.send(Message(text=auto + answer), thread_id=thread_id, thread_type=thread_type)
            return

        # 2) unknown message
        if thread_id in bloc_threads:
            return
        try:
            name = self.fetchThreadInfo(thread_id)[thread_id].name or ''
        except Exception:
            name = ''
        if thread_id not in prev_threads:
            body = data.txt1
            prev_threads.append(thread_id)
        else:
            body = data.txt2
            bloc_threads.append(thread_id)
        text = '%s\n%s, %s\nTimestamp: %s' % (auto, name, body, stamp)
        self.send(Message(text=text.replace(' ,', ',')), thread_id=thread_id, thread_type=thread_type)


try:
    print('Checking for cookies...')
    with open('cookies.p', 'rb') as f:
        session_cookies = pickle.load(f)
    client = CustomClient('cookie', 'cookie', session_cookies=session_cookies)
    print('Cookies found!')
except Exception:
    print('Cookies not found or expired. Please enter credentials.')
    client = CustomClient(input('Email: '), getpass('Password: '))
    with open('cookies.p', 'wb') as f:
        pickle.dump(client.getSession(), f)
    print('Cookies saved to cookies.p file.')

print('Starting program...')
client.listen()
