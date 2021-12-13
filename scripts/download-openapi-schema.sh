mkdir .tmp-open-api-spec
cd .tmp-open-api-spec
git clone https://github.com/OAI/OpenAPI-Specification.git
if [ ! -f ../src/generated/schemas ]
then
  mkdir -p ../src/generated/schemas
fi
schema=`cat OpenAPI-Specification/schemas/v3.1/schema.json`
echo "export default $schema as const;" > ../src/generated/schemas/v3.1.ts
cd ..
rm -rf .tmp-open-api-spec 