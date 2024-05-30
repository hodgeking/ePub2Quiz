import urllib.request
from ebooklib import epub
import re
from bs4 import BeautifulSoup
import redis
import os
from dotenv import load_dotenv

load_dotenv()

# cache for text content of chapters
r = redis.Redis(
    host=os.getenv('REDIS_HOST'),
    port=15794,
    password=os.getenv('REDIS_PW'))


def get_content(selected_hrefs, url):
    """
    Given a list of hrefs and an url, get content of the selected chapters from an EPUB file as a list of strings.
    """

    # depending on whether a temp file is in there already, we have to use another name (in case of multiple users)
    temp_file_name = 'temporary_save.epub'

    for i in range(100):  # while loop would be possible too but im limiting it to 100 epubs at once
        if os.path.exists(temp_file_name):
            temp_file_name = f'temporary_save{i}.epub'
        else:
            break

    # keep trying to download file until it works (sometimes it fails due to ContentTooShortError)
    while True:
        try:
            urllib.request.urlretrieve(url, temp_file_name)
            break
        except Exception as e:
            print(f'Error: {e}')
            print('Trying again...')

    # parse the epub file
    book = epub.read_epub(temp_file_name)

    # get all hrefs in the order they appear in the TOC
    def extract_hrefs(item):
        # if item is a tuple, it represents a section with its own items
        if isinstance(item, tuple):
            # first element is the section, second is the list of subsections/items
            section, subsections = item
            # start with the section's href (if it exists), recursively get hrefs from ssections
            hrefs = [section.href] if hasattr(section, 'href') else []
            for subitem in subsections:
                hrefs.extend(extract_hrefs(subitem))
            return hrefs
        # if item is a Link we can directly get its href
        elif isinstance(item, epub.Link):
            return [item.href]
        # return empty list as fallback
        return []

    # start extracting hrefs from top-level TOC items
    all_hrefs = []
    for item in book.toc:
        all_hrefs.extend(extract_hrefs(item))

    # sort selected hrefs in the order they appear in the TOC
    hrefs_in_order = []
    for href in all_hrefs:
        if href in selected_hrefs:
            hrefs_in_order.append(href)

    selected_hrefs = hrefs_in_order
    print('selected hrefs', selected_hrefs)

    # get the content of the selected hrefs
    selected_chapters = []
    # if both parent and child are in the list, we should take the parent
    # (otherwise we would get double content, as child is part of the parent)
    new_href_list = selected_hrefs.copy()  # to prevent changing the list while iterating
    for href in selected_hrefs:
        if "#" in href:
            chapter = href.split("#")[0]
            if chapter in selected_hrefs:
                new_href_list.remove(href)

    selected_hrefs = new_href_list
    print('selected hrefs', selected_hrefs)

    for href in selected_hrefs:
        print('current href', href)
        # try to get the content from Redis
        key = f'{url}:{href}'
        chapter_content = r.get(key)

        if chapter_content is not None:
            # if content was found in cache, decode it from bytes to string
            chapter_content = chapter_content.decode('utf-8')
            print(f'cache hit for {key}')
        else:
            print(f'cache missing for {key}')

            # if href has #, then it is not a separate chapter file, but a part of a chapter
            if '#' in href:
                chapter = href.split('#')[0]
                anchor = href.split('#')[1]
                next_anchor = None

                # find next href in all_hrefs that has the same base chapter
                for next_href in all_hrefs[all_hrefs.index(href) + 1:]:
                    if next_href.startswith(chapter + '#'):
                        next_anchor = next_href.split('#')[1]
                        break

                for item in book.get_items():
                    if item.get_name() == chapter:
                        content = item.get_body_content().decode('utf-8')
                        fragment_content = []
                        fragment_passed = False  # whether the anchor fragment was observed already

                        for line in content.split("\n"):
                            # we need to look for a point to stop if we found the id fragment already
                            if fragment_passed:
                                # if we find a line starting with the next anchor we stop
                                if next_anchor and re.findall(f'.+id="{next_anchor}".+', line):
                                    break
                                else:
                                    fragment_content.append(line)

                            else:
                                # find line with anchor fragment
                                pattern_current_id = f'.+id="{anchor}".+'
                                if re.findall(pattern_current_id,
                                              line):  # if no match, re.findall returns [] which is not True
                                    fragment_content.append(line)
                                    fragment_passed = True

                        chapter_content = BeautifulSoup('\n'.join(fragment_content),
                                                        'html.parser').get_text()  # parse html to get text only
                        # chapter_content = ''.join(fragment_content)  # if we want to keep html tags instead
                        chapter_content = f'\n\n[HREF START:\t{href}\t]' + '\n' + chapter_content + '\n' + f'[HREF END:\t{href}\t]'
            else:  # if we are looking for a chapter that is a separate file already
                for item in book.get_items():
                    if item.get_name() == href:
                        content = item.get_content().decode('utf-8')
                        chapter_content = BeautifulSoup(content,
                                                        'html.parser').get_text()  # parse html to get text only
                        # chapter_content = ''.join(content)  # if we want to keep html tags
                        chapter_content = f'\n\n[HREF START:\t{href}\t]' + '\n' + chapter_content + '\n' + f'[HREF END:\t{href}\t]'
            r.set(key, chapter_content)

        selected_chapters.append(chapter_content)

    # delete temporary file
    os.remove(temp_file_name)

    return selected_chapters  # list with text of the selected hrefs
