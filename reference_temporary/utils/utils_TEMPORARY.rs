use serde_json::Value;

/// Utility function to serialize a vector of strings into a single string.
pub fn serialize_array(array: &Vec<String>) -> String {
    let mut result = String::new();
    let len = array.len();

    result.push_str("[ ");
    for (i, element) in array.iter().enumerate() {
        result.push_str("\"");
        result.push_str(element);
        result.push_str("\"");
        if i < len - 1 {
            result.push_str(", ");
        }
    }
    result.push_str(" ]");

    result
}

/// Utility function to convert a vector of strings into a vector of serde_json values.
pub fn to_value_array(array: &Vec<String>) -> Vec<Value> {
    array
        .iter()
        .map(|pw| Value::String(pw.clone()))
        .collect::<Vec<Value>>()
}

/// Utility function to convert a vector of serde_json values to a vector of strings.
pub fn from_value_array(values: &Vec<Value>, variable: String) -> Result<Vec<String>, String> {
    let mut result: Vec<String> = Vec::new();

    for value in values {
        match value {
            Value::String(string) => {
                result.push(string.clone());
            }
            _ => return Err(format!("{variable} [{value}] is not a String.")),
        };
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::delegation::utils::utils::serialize_array;

    #[test]
    fn test_serialize_array() {
        let vec = vec!["w_delegatee_id_c", "w_iat_c", "w_exp_c"];
        let vec_string = vec.iter().map(|x| x.to_string()).collect::<Vec<String>>();
        println!("{}", serialize_array(&vec_string))
    }
}
