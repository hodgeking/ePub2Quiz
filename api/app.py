import random
import os
import re
import nltk
from nltk.tokenize import sent_tokenize
import boto3
import tiktoken
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from epubcheck import EpubCheck  # to check validity of epub file

from api.lm_quiz_generation import prompt_model
from api.parse_hrefs import get_content

load_dotenv()

nltk.download('punkt')  # for sentence tokenization

app = Flask(__name__, static_folder='../build', static_url_path='/')


@app.route('/')
def index():
    return app.send_static_file('index.html')  # serve react app


# s3 client for digitalocean spaces
session = boto3.session.Session()
client = session.client('s3',
                        region_name='fra1',
                        endpoint_url='https://nyc3.digitaloceanspaces.com',
                        aws_access_key_id=os.getenv('SPACES_KEY'),
                        aws_secret_access_key=os.getenv('SPACES_SECRET'))

# spaces bucket name
BUCKET_NAME = os.getenv('BUCKET_NAME')


# simple authentication with password
@app.route('/api/authenticate', methods=['POST'])
def authenticate():
    if request.json.get('password') == os.getenv('WEB_PASS'):  # password will be encrypted env variable on digitalocean
        return {'authenticated': True}, 200  # ok
    else:
        return {'authenticated': False}, 401  # unauthorized, wrong password


# upload epub file to DigitalOcean spaces and return URL
@app.route('/api/upload', methods=['POST'])
def upload_file():
    file = request.files['file']
    if file.filename == '':
        return jsonify(
            {'message': 'No file selected'}), 400

    # check if user wants to validate epub
    check_validity = request.form.get('check_validity') == 'true'

    # upload file to digitalocean spaces
    try:
        client.upload_fileobj(file, BUCKET_NAME, file.filename)

        # create presigned URL for the file
        url = client.generate_presigned_url('get_object',
                                            Params={'Bucket': BUCKET_NAME,
                                                    'Key': file.filename},
                                            ExpiresIn=3600 * 24)  # 24 hours

        if check_validity:
            # check if epub is valid (but takes a long time)
            result = EpubCheck(url)
            if not result.valid:
                # check if level='FATAL' in result.result_data dict in messages
                # usually errors below severity 'FATAL' are not that important
                # (since reader still shows it, and we can parse file)
                messages = result.result_data.get('messages', [])
                for msg in messages:
                    if msg.get('severity') == 'FATAL':
                        print('FATAL ERROR:', msg)
                        return jsonify({
                            'message': 'Your epub file is not valid. Please try again with another file.'}), 422  # unprocessable entity

        return jsonify({'file_url': url}), 200  # return JSON response (200 means OK)

    except Exception as e:
        return jsonify({'error': str(e)}), 500  # return JSON error response (500 means Internal Server Error)


# verify if quiz content contains all necessary keys
def check_quiz_content(quiz, num_questions):
    question_keys = ['question', 'correct_answer', 'options', 'explanation', 'answer_location', 'href',
                     'question_number']

    for question in quiz['questions']:
        if not all(question.get(key) for key in question_keys):  # check if all keys are included
            return False

    if len(quiz['questions']) != num_questions:  # check if we have the correct amount of questions
        return False

    return True


# quiz generation logic (maximum tokens, what happens if content is too long)
@app.route('/api/generate_quiz', methods=['POST'])
def generate_quiz():  # server sends ebook url (ebookUrl, hrefs (selectedChapters) and number of questions (numQuestions)

    # use get_content from parse_hrefs.py to get text content of hrefs
    content = get_content(request.json['selectedChapters'], request.json['ebookUrl'])
    concatenated_content = ' '.join(content)

    # count tokens in the concatenated content
    enc = tiktoken.encoding_for_model('gpt-3.5-turbo-0125')  # encoding for gpt-5.5-turbo
    num_tokens = len(enc.encode(concatenated_content))

    # change approach if you do not want to use Gemini for too long content
    # approach = 'split_parts'
    # approach = 'random_chapters'
    # approach = 'gpt4'
    approach = 'random_chapters'

    token_limit = 13800  # for chapter content; (total context window of gpt-3.5 is approx 16k tokens, including prompt + output)
    retry_count = 0

    while True:
        # different approaches to test when content above token limit
        if num_tokens > token_limit:
            if approach == 'split_parts':  # splits parts into chunks with tokens less than token limit

                # calculate tokens in each content part
                content_counts = [len(enc.encode(part)) for part in content]

                # split content into parts under token limit
                content_parts = []
                current_part = ''
                current_count = 0
                for i, part in enumerate(
                        content):  # content_counts[i] is token count for chapter currently being processed

                    if current_count + content_counts[i] > token_limit:  # if adding next chapter would be > limit

                        if current_part:  # if current part is not empty, add it to the list
                            # add the parts concatenated up until the current chapter (not included)
                            content_parts.append(current_part)
                        current_part = ''
                        current_count = 0

                        # if one chapter alone is already above limit, split into smaller parts
                        # logic could be improved, but for now we split into sentences
                        if content_counts[i] > token_limit:
                            # remove [HREF START:\t.+\t] and [HREF END:\t.+\t] from the part
                            start_pattern = r'\[HREF START:\t.+\t\]'
                            end_pattern = r'\[HREF END:\t.+\t\]'

                            # get href start and end, save for later
                            href_start = re.findall(start_pattern, part)[0]
                            href_end = re.findall(end_pattern, part)[0]

                            # remove href start and end
                            part = re.sub(start_pattern, '', part)
                            part = re.sub(end_pattern, '', part)

                            # tokenize into sentences
                            sentences = sent_tokenize(part)
                            current_part = ""
                            current_token_count = 0

                            # create smaller parts under token limit
                            for sentence in sentences:
                                sentence_token_count = len(enc.encode(sentence))

                                # add as long as we are under token limit
                                if current_token_count + sentence_token_count < token_limit:
                                    current_part += sentence + " "
                                    current_token_count += sentence_token_count
                                else:
                                    # add to final list (include hrefs)
                                    current_part = f'[HREF START:\t{href_start}\t]\n' + current_part + f'\n[HREF END:\t{href_end}\t]'
                                    content_parts.append(current_part.strip())
                                    current_part = sentence + " "
                                    current_token_count = sentence_token_count

                            if current_part.strip():  # if there's still something left
                                current_part = f'[HREF START:\t{href_start}\t]\n' + current_part + f'\n[HREF END:\t{href_end}\t]'
                                content_parts.append(current_part.strip())

                            continue

                    else:  # if adding next chapter would be <= limit
                        current_part += part
                        current_count += content_counts[i]

                content_parts.append(current_part)  # add the last part

                # check how many parts we have, decide how many questions to get from each part
                num_parts = len(content_parts)
                num_per_part = (int(request.json['numQuestions']) // num_parts) + 1  # add 1 as buffer

                # get quiz for each content part
                quizzes = []
                for part in content_parts:
                    quiz = prompt_model(part, num_per_part, options_per_question=4)
                    quizzes.append(quiz)

                amount_quest = int(request.json['numQuestions'])
                final_quiz = []

                # we want to return the amount of questions the user asked for,
                # but mix in questions randomly from all quizzes

                # randomly select one of the "quizzes" and take one single question, repeat until enough questions
                for i in range(amount_quest):
                    quiz = random.choice(quizzes)
                    question = random.choice(quiz['questions'])  # get random question from the quiz
                    quiz['questions'].remove(question)  # delete that question from the quiz so we don't get duplicates
                    # if quiz is empty, remove from the list
                    if not quiz['questions']:
                        quizzes.remove(quiz)
                    final_quiz.append(question)

                # put everything together
                quiz = {'questions': final_quiz}

                print('[INFO] used splitting into parts approach with gpt-3')  # as info in console
                quiz['model_used'] = 'gpt-3.5-turbo-0125'
                quiz['total_tokens'] = num_tokens

                if not check_quiz_content(quiz, int(request.json['numQuestions'])):  # restart loop if quiz is not valid
                    retry_count += 1
                    if retry_count > 3:
                        return jsonify({'error': 'server error'}), 500
                    continue  # continue if retry count is <= 3

                return jsonify(quiz), 200

            elif approach == 'gpt4':  # use gpt-4 for content below 60k tokens, could handle up to 128k
                if num_tokens < 60000:  # limit for now due to cost
                    # use gpt 4 turbo with 128k tokens context
                    quiz = prompt_model(concatenated_content, int(request.json['numQuestions']), options_per_question=4,
                                        model='gpt-4-0125-preview')

                    print('[INFO] used gpt-4')
                    quiz['model_used'] = 'gpt-4-0125-preview'
                    quiz['total_tokens'] = num_tokens

                    if not check_quiz_content(quiz,
                                              int(request.json['numQuestions'])):  # restart loop if quiz is not valid
                        retry_count += 1
                        if retry_count > 3:
                            return jsonify({'error': 'server error'}), 500
                        continue  # continue if retry count is <= 3

                    return jsonify(quiz), 200
                else:
                    return jsonify({'content': 'content too long'}), 200

            elif approach == 'gemini':
                if num_tokens < 1000000:  # limit of gemini 1.5 pro

                    gemini_1_max_tokens = 30000  # max tokens for gemini-1.0-pro

                    quiz = prompt_model(concatenated_content, int(request.json['numQuestions']), options_per_question=4,
                                        model='gemini', num_tokens=num_tokens, gemini_1_max=gemini_1_max_tokens)

                    # if quiz is None, return server error
                    if quiz is None:
                        return jsonify({'error': 'server error'}), 500

                    if quiz == 'split_parts':  # switch approach to split parts (when quota is reached or other problem)
                        approach = 'split_parts'
                        print('[INFO] switching to split parts approach')
                        continue

                    if num_tokens < gemini_1_max_tokens:  # use gemini-1.0-pro for content below 30k tokens, could be up to 32k but we add buffer
                        quiz['model_used'] = 'gemini-1.0-pro'
                    else:  # can handle up to 1M tokens
                        quiz['model_used'] = 'gemini-1.5-pro'
                    quiz['total_tokens'] = num_tokens

                    if not check_quiz_content(quiz,
                                              int(request.json['numQuestions'])):  # restart loop if quiz is not valid
                        retry_count += 1
                        if retry_count > 3:
                            return jsonify({'error': 'server error'}), 500
                        continue  # continue if retry count is <= 3

                    return jsonify(quiz), 200  # else OK
                else:
                    return jsonify({'content': 'content too long'}), 200

            elif approach == 'random_chapters':  # randomly select chapters until we have 14000 tokens
                # calculate tokens in each content part
                content_counts = [len(enc.encode(part)) for part in content]

                current_count = 0
                concatenated_content = ''

                while current_count < token_limit:
                    # get random index
                    random_index = random.randint(0, len(content) - 1)

                    # if adding the next chapter would get more than 14000 tokens
                    if current_count + content_counts[random_index] > token_limit:
                        break

                    current_count += content_counts[random_index]
                    concatenated_content += content[random_index]

                    # remove the chapter
                    content.pop(random_index)
                    content_counts.pop(random_index)

                quiz = prompt_model(concatenated_content, int(request.json['numQuestions']), options_per_question=4)

                print('[INFO] used random chapters approach with gpt-3.5-turbo-0125')

                if quiz is None:
                    return jsonify({'error': 'server error'}), 500

                quiz['model_used'] = 'gpt-3.5-turbo-0125'
                quiz['total_tokens'] = num_tokens

                if not check_quiz_content(quiz, int(request.json['numQuestions'])):  # restart loop if quiz is not valid
                    retry_count += 1
                    if retry_count > 3:
                        return jsonify({'error': 'server error'}), 500
                    continue  # continue if retry count is <= 3

                return jsonify(quiz), 200

        else:  # if content is less than token limit, use gpt-3.5
            quiz = prompt_model(concatenated_content, int(request.json['numQuestions']), options_per_question=4)
            quiz['model_used'] = 'gpt-3.5-turbo-0125'
            quiz['total_tokens'] = num_tokens

            print('[INFO] used gpt-3.5')

            if not check_quiz_content(quiz, int(request.json['numQuestions'])):  # restart loop if quiz is not valid
                retry_count += 1
                if retry_count > 3:
                    return jsonify({'error': 'server error'}), 500
                continue  # continue if retry count is <= 3

            return jsonify(quiz), 200
