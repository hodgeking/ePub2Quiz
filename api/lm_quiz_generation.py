import os
import openai
from dotenv import load_dotenv
import json
import tiktoken
import google.generativeai as genai
import fix_busted_json

load_dotenv()

# openai api key and organization env variables
openai.organization = os.getenv('OPENAI_ORG')
openai.api_key = os.getenv('OPENAI_API_KEY')

# encoding to count tokens
enc = tiktoken.encoding_for_model('gpt-3.5-turbo')

# api for google gemini models
genai.configure(api_key=os.getenv('GAPI'))


def prompt_model(text, num_questions=4, options_per_question=4,
                 difficulty='', model='gpt-3.5-turbo-0125', num_tokens=0, not_valid_max=3, gemini_1_max=30000):
    """
    Function to generate multiple-choice quizzes with given parameters and text as input. Returns a JSON object with
    the quiz if successful, "split_parts" if the text is too long for the model, and None if the function fails.
    """
    valid_output = False

    # dictionary for number to word conversion
    number_dict = {1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six',
                   7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten'}

    # if you choose prompt template 1 or 2, you will need to adjust "check_quiz_content" function in app.py accordingly
    prompt_1 = f"""
Based on the text below, generate {num_questions} {difficulty} meaningful multiple-choice questions with \
{options_per_question} answer choices each, ensuring one correct answer. Format the output as JSON, like this example:
{{
    "questions": [
        {{
            "answer_location": "[insert original sentence where the answer is found, word for word]",
            "correct_answer": ["C"],
            "options": {{
                "A": "Zurich",
                "B": "Berlin",
                "C": "Paris",
                "D": "Madrid"
            }},
            "question": "What is the capital of France?"
        }},
        // Insert {num_questions - 1} more questions here
    ]
}}
Text: 
----
{text}
----
    """

    # for prompt template 2
    example_text = "The modulo operator (%) in Python gives us the remainder when dividing two numbers. We write it as a % b, where a and b are the numbers, for instance 5 %% 2, which would result in 1."

    # approx 310 tokens with template alone
    prompt_2 = f"""
Based on the text below, generate {number_dict.get(num_questions)} {difficulty}meaningful multiple-choice questions with
{options_per_question} answer choices each, ensuring one correct answer. Format the output as JSON. 

EXAMPLE:
Text: 
----
{example_text}
----

Output: 
{{
"questions": [
    {{
        "question": "What is the output of the following Python code: print(7 % 2)",
        "answer_location": "The modulo operator (%) in Python gives us the remainder when dividing two numbers.",
        "correct_answer": ["A"],
        "options": {{
            "A": "1",
            "B": "False",
            "C": "SyntaxError",
            "D": "3.5"
        }}
        
    }},
    // Insert {number_dict.get(num_questions - 1)} more questions here
]
}}

YOUR TASK:
Now create {number_dict.get(num_questions)} {difficulty} questions with {options_per_question} answer choices each based on the text below in the same style.

Text: 
----
{text.strip()}
----"""

    prompt_3 = f"""
Text: 
----
{text.strip()} 
----

Based on the text above, generate {number_dict.get(num_questions)} meaningful multiple-choice questions with
{options_per_question} answer choices each, ensuring one correct answer. Follow the principles of constructing multiple-choice items in education.
Format the output as JSON and follow the template and instructions below.

Difficulty level: hard

Output Template: 
{{
    "questions": [
        {{
            "question": "[insert plausible question based on the text]",
            "answer_location": "[word for word, sentence where the answer is found in the text]",
            "correct_answer": ["A"],
            "options": {{
                "A": "insert plausible option",
                "B": "insert plausible option",
                "C": "insert plausible option",
                "D": "insert plausible option"
                }},
            "explanation": "[insert explanation of why the correct answer is correct]",
            "question_number": "[insert question number as integer]"

        }},
        // Insert {number_dict.get(num_questions - 1)} more questions here
    ]
}}
    """

    prompt_4 = f"""
Text: 
----
{text.strip()} 
----

Based on the text above, generate {number_dict.get(num_questions)} meaningful multiple-choice questions with
{options_per_question} answer choices each, ensuring one correct answer. Follow the principles of constructing multiple-choice items in education.
Do not repeat options. Chose different examples from those already mentioned in the text if applicable. Answer options can be long or short.
Pretend that the user will not have access to the text when answering the questions, so the questions should be self-contained. 

Format the output as JSON and follow the template and instructions below. 

Difficulty level: hard 

Output Template: 
{{
    "questions": [
        {{
            "question": "[insert plausible question based on the text]",
            "correct_answer": ["A"], 
            "options": {{
                "A": "insert correct plausible option",
                "B": "insert plausible option",
                "C": "insert plausible option",
                "D": "insert plausible option"
                }},
            "explanation": "[helps the user understand why the other options are incorrect]",
            "answer_location": "[word for word, (part of) the sentence where the answer is found in the text, in the exact same format as in the text]",
            "href": "[insert the href name in which the answer is found, boundaries in the text are denoted by HREF START and HREF END (including file extension .html or .xhtml, #anchor if available and whole path if applicable)]",
            "question_number": "[insert question number as integer]"

        }},
        // Insert {number_dict.get(num_questions - 1)} more questions here
    ]
}}
        """

    prompt_5 = f"""
Text: 
----
{text.strip()} 
----

Based on the text above, generate {number_dict.get(num_questions)} multiple-choice questions with {options_per_question} answer choices each, ensuring one correct answer per question.
Each question item has a question, one correct answer, answer choices, an explanation, an answer location, an href and a question number.


Follow these rules for each part:
    question:
        - should be clear, unambiguous, hard to guess
        - can be preceded by other sentences to give context and frame the question, e.g. "Suppose we have ...", "The text discusses ...", "In the context of ..."
        - include examples if necessary, especially for practical questions (but do not repeat examples from the text)
        - avoid using verbatim sentences from the text, encourage critical thinking rather than learning by heart
        - are self-contained (the user does not need to have access to the text to answer)
    answer choice:
        - are be plausible and related to the question, but only one is clearly correct
        - incorrect answer choices (distractors) include common errors/misconceptions
        - no duplicate answer options
        - have varying wording within a question
        - have the correct answer choice randomly positioned
    answer location:
        - if the answer is not explicitly stated in the text, the most relevant sentence that would help to answer the question is returned
        - exists in the text above
        - is the most important sentence if the question answer is based on a longer passage
        - is correct and relevant to the question
    explanation: 
        - helps the user why the other answer choices are incorrect

Format the output as JSON and follow the instructions.

Output Template: 
    {{
        "questions": [
            {{
                "question": "[insert plausible question based on the text]",
                "correct_answer": ["A"], 
                "options": {{
                    "A": "insert correct plausible option",
                    "B": "insert plausible option",
                    "C": "insert plausible option",
                    "D": "insert plausible option"
                    }},
                "explanation": "[helps the user understand why other options are incorrect]",
                "answer_location": "[word for word, (part of) sentence where the answer is found in the text, in the exact same format as in the text]",
                "href": "[insert the href name in which the answer is found, boundaries in the text are denoted by HREF START and HREF END (including file extension .html or .xhtml, #anchor if available and whole path if applicable)]",
                "question_number": "[insert question number as integer]"

            }},
            // Insert {number_dict.get(num_questions - 1)} more questions here
        ]
    }}
    """

    current_prompt = prompt_4

    # token count of prompt
    # print('prompt token count:', len(enc.encode(current_prompt)))

    not_valid_counter = 0  # we do not want to go on forever if we cannot get valid output
    while not valid_output:
        not_valid_counter += 1
        if not_valid_counter > not_valid_max:
            print('[INFO] too many attempts')  # for runtime logs
            return None  # front end will show "oops..." message to user in case of no quiz

        if model == 'gemini':
            try:
                #  gemini-1.0-pro (up to 30k input window); gemini-1.5-pro-latest up to 1mio currently
                if num_tokens < gemini_1_max:
                    gemini = genai.GenerativeModel('gemini-1.0-pro')
                    response = gemini.generate_content(current_prompt)

                    print('[INFO] used gemini 1.0')
                    print('[INFO] prompt token count:', len(enc.encode(current_prompt)))

                    # log in a text file, we could also use a db
                    with open('logs/gemini_completions.txt', 'a+') as f:
                        f.write(f'{response}\n')
                    # max 60 RPM currently, for most recent info check
                    # https://ai.google.dev/gemini-api/docs/models/gemini#model-variations

                else:
                    # currently a preview model, do not use for production
                    gemini = genai.GenerativeModel('gemini-1.5-pro-latest')  # gemini-1.5-flash would be possible too
                    response = gemini.generate_content(current_prompt)

                    print('[INFO] used gemini 1.5')
                    print('[INFO] prompt token count:', len(enc.encode(current_prompt)))

                    with open('logs/gemini1.5_completions.txt', 'a+') as f:
                        f.write(f'{response}\n')

                # gemini usually starts json with markdown-like format in the response
                # ```JSON or ```json which leads to problems with json.loads
                # json_repair is for repairing any syntax errors that LLMs usually make
                response_trimmed = response.text.lstrip("```JSON").rstrip("```")
                response_trimmed = response_trimmed.lstrip("```json")  # since rstrip from previous includes ending `

                final_completion = json.loads(fix_busted_json.repair_json(response_trimmed))  # fix json if possible
                valid_output = True

            except Exception as e:
                # if it is not valid json, we need to try again
                print(f'Error: {e}')
                print('Trying again...')
                # if not valid x times, switch to a fallback approach: e.g. splitting parts in chunks
                # especially if error regarding quota etc? (for gemini 1.0 we
                # have 60 RPM but for 1.5 less)
                if not_valid_counter == not_valid_max:
                    return 'split_parts'

        else:  # gpt-3 model with 16k token context
            try:

                completion = openai.chat.completions.create(model=model,
                                                            # temperature=0.6,  # if you want to adjust temperature
                                                            response_format={"type": "json_object"},
                                                            messages=[{"role": "system",
                                                                       "content": "You are a helpful assistant designed to output JSON."},  # needed for json output mode
                                                                      {"role": "user", "content": current_prompt}])

                with open('logs/chatgpt_completions.txt', 'a') as f:
                    f.write(f'{completion}\n')

                # if it is valid json, we can break the loop
                # possible that completion has bad json format, so we need to account for that with fix_busted_json
                final_completion = json.loads(fix_busted_json.repair_json(completion.choices[0].message.content))

                with open('logs/json_outputs.txt', 'a') as f:
                    # log final completion together with "prompt" and "num_questions" and "options_per_question"
                    log_data = {
                        "completion": final_completion,
                        "prompt": current_prompt,
                        "num_questions": num_questions,
                        "options_per_question": options_per_question,
                        "model": model
                    }
                    f.write(f'{json.dumps(log_data)}\n')

                valid_output = True
            except Exception as e:
                # if it is not valid json, we need to try again
                print(f'Error: {e}')
                print('Trying again...')

    return final_completion  # returns questions in json format according to prompt
