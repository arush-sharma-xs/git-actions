import os, json
from pydantic import create_model
from openai import OpenAI
import logging

logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger()

# Environment variables for OpenAI API and model
API_VERSION = os.getenv("OPENAI_API_VERSION")
API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("MODEL")

client = OpenAI()

def handle_booking_agent(Class, query, json_data, attempt_count, max_attempts, user_role, task, job):
    try:
        schema_class = Class
        completion = client.beta.chat.completions.parse(
            model=MODEL,
            messages=[
                {"role": "system", "content": "Extract the event information. If value not found just write 'None', else keep everything 'None'"},
                {"role": "user", "content": query},
            ],
            response_format=schema_class,
        )

        data = completion.choices[0].message.parsed
        logger.info(f"Parsed data: {data}")

        for key in json_data.keys():
            if getattr(data, key) != "None":
                json_data[key] = getattr(data, key)

        if all(value is not None for value in json_data.values()):
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": f"Act as a {user_role}. Your task was {task}, which is now completed. Provide the user with a success message, and present the JSON data in a professional manner. Write answer without using emphesis.",
                    },
                    {
                        "role": "user",
                        "content": str(json_data)
                    }
                ]
            )
            conversation_message = response.choices[0].message.content
            return conversation_message, False, json_data  # Booking complete

        if attempt_count == 0:
            # if max_attempts == attempt_count:
            #     response = client.chat.completions.create(
            #         model=MODEL,
            #         messages=[
            #             {
            #                 "role": "system",
            #                 "content": f"Act as a {user_role}. Inform the user that the maximum attempts have been reached and status of incomplete fields.",
            #             },
            #             {
            #                 "role": "user",
            #                 "content": str(json_data)
            #             }
            #         ]
            #     )
            #     conversation_message = response.choices[0].message.content
            #     return conversation_message, True, json_data

            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": f"Act as a {user_role}. Ask the user to complete the missing job fields {job}. Write answer without using emphesis.",
                    },
                    {
                        "role": "user",
                        "content": str(json_data)
                    }
                ]
            )
            conversation_message = response.choices[0].message.content
            return conversation_message, True, json_data

        missing_fields = [k for k, v in json_data.items() if not v]
        if missing_fields:
            logger.info(f'Missing fields {missing_fields}')
            if max_attempts == attempt_count:
                response = client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {
                            "role": "system",
                            "content": f"Act as a {user_role}. Inform the user that the maximum attempts have been reached and status of incomplete fields. Write answer without using emphesis.",
                        },
                        {
                            "role": "user",
                            "content": str(missing_fields)
                        }
                    ]
                )
                conversation_message = response.choices[0].message.content
                return conversation_message, True, json_data
            
            elif max_attempts > attempt_count:
                response = client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {
                            "role": "system",
                            "content": f"Act as a {user_role}. Ask the user to fill the following missing fields: {missing_fields}, professionally. Write answer without using emphesis.",
                        },
                        {
                            "role": "user",
                            "content": str(missing_fields)
                        }
                    ]
                )
                conversation_message = response.choices[0].message.content
                return conversation_message, True, json_data  # Need more info
    except Exception as e:
        logger.error(f"Error in handle_booking_agent: {str(e)}")
        return None, True, json_data  # Return that more info is needed in case of failure


def handle_user_message(Class, user_query, json_data, attempt_count, max_attempts, user_role, task, job):
    try:
        conversation_message, need_more_info, updated_json_data = handle_booking_agent(
            Class, user_query, json_data, attempt_count, max_attempts, user_role, task, job
        )
        logger.info(f"Attempt count: {attempt_count}")

        if need_more_info:
            return conversation_message, True, updated_json_data, attempt_count
        else:
            return conversation_message, False, updated_json_data, attempt_count
    except Exception as e:
        logger.error(f"Error in handle_user_message: {str(e)}")
        return None, True, json_data, attempt_count


def lambda_handler(event, context):
    try:
        logger.info(f'Incoming event: {json.dumps(event)}')
        body = event.get('body', '{}')
        event = json.loads(body) if isinstance(body, str) else body
        logger.info(f'Parsed event: {json.dumps(event)}')

        json_data = event.get('schema', '')
        if json_data:
            json_data = json.loads(json_data) if isinstance(json_data, str) else json_data
            
        else:
            return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Empty schema provided'})
            }

        user_query = event.get('user_query', '')
        max_attempts = event.get('max_attempts', '')
        user_role = event.get('user_role', '')
        task = event.get('task', '')
        job = event.get('job', '')
        attempt_count = event.get('attempt_count', '')
        temp_var = false
        
        
        if not user_query or not user_role or not task or not job or not max_attempts or not attempt_count:
            return {
            'statusCode': 400,
            'body': json.dumps({'error': 'One or more required fields are missing or invalid'})
            }

        # Ensure max_attempts and attempt_count are integers
        max_attempts = int(max_attempts)
        attempt_count = int(attempt_count)
        
        if attempt_count >= max_attempts:
            return {
            'statusCode': 503,
            'body': json.dumps({'error': 'Maximum attempts reached'})
            }
            
        logger.info(f'JSON data: {json_data}')
        Class = create_model(
                'Details', 
                **{key: (str, None) for key in json_data.keys()}
            )
            
        attempt_count += 1

        conversation_message, need_more_info, json_data, attempt_count = handle_user_message(
            Class, user_query, json_data, attempt_count, max_attempts, user_role, task, job
        )

        logger.info(f"Assistant response: {conversation_message}")

        return {
            'statusCode': 200 if not need_more_info else 202,
            'body': json.dumps({'json_data': json_data, 'attempt_count': attempt_count, 'conversation': conversation_message})
        }
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'An error occurred in gen ai response lambda'})
        }
