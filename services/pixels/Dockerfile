# The pixel tools as an AWS Lambda container: Python with Pillow, NumPy and OpenCV, which a Node function cannot carry.
FROM public.ecr.aws/lambda/python:3.13

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir --only-binary=:all: -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py product_lock.py pack_check.py cap_check.py photo_finish.py food_crop.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
